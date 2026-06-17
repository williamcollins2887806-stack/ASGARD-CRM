/**
 * Settings → таб «Компания»: реквизиты профиля.
 */
export default function CompanyTab({ app, setApp }) {
  const c = app.company_profile || {};
  const set = (k, v) =>
    setApp((a) => ({ ...a, company_profile: { ...(a.company_profile || {}), [k]: v } }));

  return (
    <div className="sett-grid">
      <div className="sett-card col-span-2">
        <h3>🏢 Профиль компании</h3>
        <p className="sett-hint">
          Реквизиты подставляются в шаблоны документов (ТКП, акт, счёт-фактура).
        </p>

        <div className="sett-row sett-row--single">
          <div className="sett-field">
            <label>Наименование</label>
            <input
              className="inp-text"
              placeholder="ООО «АСГАРД-Сервис»"
              value={c.company_name || ''}
              onChange={(e) => set('company_name', e.target.value)}
            />
          </div>
          <div className="sett-field">
            <label>Директор (ФИО)</label>
            <input
              className="inp-text"
              placeholder="Фамилия Имя Отчество"
              value={c.director_fio || ''}
              onChange={(e) => set('director_fio', e.target.value)}
            />
          </div>
        </div>

        <div className="sett-row">
          <div className="sett-field">
            <label>ИНН</label>
            <input
              className="inp-text"
              value={c.inn || ''}
              onChange={(e) => set('inn', e.target.value)}
            />
          </div>
          <div className="sett-field">
            <label>КПП</label>
            <input
              className="inp-text"
              value={c.kpp || ''}
              onChange={(e) => set('kpp', e.target.value)}
            />
          </div>
          <div className="sett-field">
            <label>ОГРН</label>
            <input
              className="inp-text"
              value={c.ogrn || ''}
              onChange={(e) => set('ogrn', e.target.value)}
            />
          </div>
          <div className="sett-field">
            <label>Телефон</label>
            <input
              className="inp-text"
              value={c.phone || ''}
              onChange={(e) => set('phone', e.target.value)}
            />
          </div>
        </div>

        <div className="sett-row sett-row--single mt-8" >
          <div className="sett-field">
            <label>Email</label>
            <input
              type="email"
              className="inp-text"
              value={c.email || ''}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
          <div className="sett-field">
            <label>Адрес</label>
            <input
              className="inp-text"
              value={c.address || ''}
              onChange={(e) => set('address', e.target.value)}
            />
          </div>
          <div className="sett-field">
            <label>Сайт</label>
            <input
              type="url"
              className="inp-text"
              placeholder="https://…"
              value={c.website || ''}
              onChange={(e) => set('website', e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
