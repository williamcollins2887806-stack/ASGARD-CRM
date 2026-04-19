import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Mail, Plus, ChevronRight, Paperclip, Send } from 'lucide-react';
import { relativeTime } from '@/lib/utils';

const FOLDERS = [
  { id: 'inbox', label: 'Входящие' }, { id: 'sent', label: 'Отправленные' },
  { id: 'drafts', label: 'Черновики' }, { id: 'archive', label: 'Архив' },
];

export default function MyMail() {
  const haptic = useHaptic();
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState('inbox');
  const [detail, setDetail] = useState(null);
  const [showCompose, setShowCompose] = useState(false);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get(`/my-mail/emails?folder_id=${folder}&limit=50`); setEmails(api.extractRows(res) || []); }
    catch { setEmails([]); } finally { setLoading(false); }
  }, [folder]);
  useEffect(() => { fetchEmails(); }, [fetchEmails]);

  const handleOpen = (email) => {
    haptic.light();
    setDetail(email);
    if (!email.is_read && !email.seen) {
      api.post(`/my-mail/emails/${email.id}/read`).catch(() => {});
    }
  };

  return (
    <PageShell title="Почта" headerRight={<button onClick={() => { haptic.light(); setShowCompose(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>}>
      <PullToRefresh onRefresh={fetchEmails}>
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FOLDERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFolder(f.id); }} className="filter-pill spring-tap" data-active={folder === f.id}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={5} /> : emails.length === 0 ? (
          <EmptyState icon={Mail} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет писем" description="Письма появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {emails.map((email, i) => {
              const unread = !email.is_read && !email.seen;
              return (
                <button key={email.id} onClick={() => handleOpen(email)} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ borderLeft: unread ? '3px solid var(--blue)' : '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-[14px] leading-tight c-primary ${unread ? 'font-bold' : 'font-semibold'}`}>{email.subject || '(без темы)'}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  <p className="text-[12px] mt-0.5 truncate c-secondary">{email.from_name || email.from || '—'}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {email.attachments?.length > 0 && <Paperclip size={10} className="c-tertiary" />}
                    {email.date && <span className="text-[10px] c-tertiary">{relativeTime(email.date)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <EmailDetailSheet email={detail} onClose={() => setDetail(null)} />
      <ComposeSheet open={showCompose} onClose={() => setShowCompose(false)} onSent={fetchEmails} />
    </PageShell>
  );
}

function EmailDetailSheet({ email, onClose }) {
  if (!email) return null;
  const e = email;
  return (
    <BottomSheet open={!!email} onClose={onClose} title={e.subject || '(без темы)'}>
      <div className="flex flex-col gap-3 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold c-primary">{e.from_name || e.from || '—'}</p>
            {e.to && <p className="text-[11px] c-tertiary">Кому: {e.to}</p>}
          </div>
          {e.date && <span className="text-[10px] c-tertiary">{relativeTime(e.date)}</span>}
        </div>
        <div className="rounded-xl p-3" style={{ background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>
          <p className="text-[13px] whitespace-pre-wrap c-primary">{e.text || e.body || e.html_text || e.preview || '—'}</p>
        </div>
        {e.attachments?.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 c-tertiary">Вложения</p>
            <div className="flex flex-wrap gap-1.5">
              {e.attachments.map((a, i) => (
                <a key={i} href={`/api/my-mail/attachments/${a.id || i}/download`} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1 rounded-full text-[11px] font-semibold spring-tap c-blue" style={{ background: 'color-mix(in srgb, var(--blue) 15%, transparent)' }}>
                  <Paperclip size={10} className="inline mr-1" />{a.filename || a.name || `Файл ${i + 1}`}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function ComposeSheet({ open, onClose, onSent }) {
  const haptic = useHaptic();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSend = async () => {
    if (!to.trim() || !body.trim()) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/my-mail/send', { to: to.trim(), subject: subject || null, body: body.trim() });
      haptic.success(); setTo(''); setSubject(''); setBody(''); onClose(); onSent();
    } catch {} setSaving(false);
  };
  const valid = to.trim() && body.trim();
  return (
    <BottomSheet open={open} onClose={onClose} title="Новое письмо">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Кому *</label><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@example.com" className="input-field" /></div>
        <div><label className="input-label">Тема</label><input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Тема письма" className="input-field" /></div>
        <div><label className="input-label">Сообщение *</label><textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Текст письма..." rows={4} className="input-field resize-none" /></div>
        <button onClick={handleSend} disabled={!valid || saving} className="btn-primary flex items-center justify-center gap-2 spring-tap mt-1" style={{ opacity: saving ? 0.6 : 1 }}><Send size={16} />{saving ? 'Отправка...' : 'Отправить'}</button>
      </div>
    </BottomSheet>
  );
}
