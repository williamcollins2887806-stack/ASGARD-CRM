package com.asgard.ting.room;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Зонд звука для Android TV.
 *
 * Отвечает на ОДИН вопрос: отдаёт ли UVC-микрофон данные через нативный
 * AudioRecord. WebView открывает то же устройство, но получает цифровую
 * тишину (в логах «MIC level=0.0000» при живом треке), и причина может быть
 * как в WebView, так и в самом устройстве/прошивке телека.
 *
 * Если здесь уровень ноль — нативный путь не поможет, дело в устройстве.
 * Если есть — React Native даст рабочий микрофон.
 *
 * Открывается кнопкой в доке ТВ или через adb:
 *   adb shell am start -n com.asgard.ting.room/.AudioProbeActivity
 */
public class AudioProbeActivity extends BridgeActivity {

    private static final int REQ_AV = 4301;
    private static final int SAMPLE_RATE = 48000;

    private TextView logView;
    private volatile boolean running = false;
    private Thread worker = null;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 48, 48, 48);
        root.setBackgroundColor(0xFF0A0C10);

        TextView title = new TextView(this);
        title.setText("Зонд микрофона");
        title.setTextSize(32);
        title.setTextColor(0xFFF4F6F8);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("Говорите в микрофон камеры 5 секунд.");
        hint.setTextSize(18);
        hint.setTextColor(0xFFB0B8C4);
        hint.setPadding(0, 12, 0, 24);
        root.addView(hint);

        ScrollView scroll = new ScrollView(this);
        logView = new TextView(this);
        logView.setTextSize(18);
        logView.setTextColor(0xFFF4F6F8);
        logView.setTextIsSelectable(true);
        scroll.addView(logView);
        root.addView(scroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AV);
        } else {
            startProbe();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_AV) {
            boolean ok = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            append("RECORD_AUDIO: " + (ok ? "разрешено" : "ОТКАЗАНО"));
            if (ok) startProbe();
        }
    }

    private void append(final String line) {
        ui.post(new Runnable() {
            @Override public void run() {
                if (logView == null) return;
                logView.append(line + "\n");
            }
        });
    }

    private void startProbe() {
        if (running) return;
        running = true;

        int minBuf = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minBuf <= 0) {
            append("AudioRecord недоступен: minBufferSize=" + minBuf);
            running = false;
            return;
        }

        final int bufSize = Math.max(minBuf, SAMPLE_RATE * 2);
        AudioRecord rec;
        try {
            rec = new AudioRecord(MediaRecorder.AudioSource.MIC,
                    SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT, bufSize);
        } catch (Exception e) {
            append("AudioRecord не создан: " + e.getClass().getSimpleName() + " " + e.getMessage());
            running = false;
            return;
        }

        if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
            append("AudioRecord не инициализирован (state=" + rec.getState() + ")");
            rec.release();
            running = false;
            return;
        }

        /* Что именно отдаёт система: тип входа и частота. Пустой/нулевой
           вход здесь — прямой ответ на «почему тишина». */
        append("SAMPLE_RATE=" + SAMPLE_RATE + " bufSize=" + bufSize +
                " sessionId=" + rec.getAudioSessionId());

        final AudioRecord record = rec;
        final short[] buf = new short[bufSize / 2];

        worker = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    record.startRecording();
                    append("startRecording OK, recordingState=" + record.getRecordingState());

                    /* 5 секунд с окнами по ~0.5 с: видно, растёт ли уровень,
                       и есть ли вообще данные (все нули = устройство молчит). */
                    long endAt = System.currentTimeMillis() + 5000;
                    int window = 0;
                    long peak = 0;
                    long sum = 0;
                    int count = 0;
                    int nonzero = 0;

                    while (System.currentTimeMillis() < endAt) {
                        int n = record.read(buf, 0, buf.length);
                        if (n < 0) {
                            append("read() вернул " + n + " — ошибка чтения");
                            break;
                        }
                        for (int i = 0; i < n; i++) {
                            int v = Math.abs(buf[i]);
                            if (v > peak) peak = v;
                            sum += v;
                            count++;
                            if (v != 0) nonzero++;
                        }
                        window++;
                        if (window % 24 == 0) {
                            long avg = count > 0 ? sum / count : 0;
                            append(String.format("окно %d: peak=%d avg=%d nonzero=%d",
                                    window / 24, peak, avg, nonzero));
                        }
                    }

                    long avgAll = count > 0 ? sum / count : 0;
                    append("----- ИТОГ -----");
                    append("сэмплов прочитано: " + count);
                    append("ненулевых: " + nonzero);
                    append("peak: " + peak);
                    append("avg: " + avgAll);
                    append("ВЕРДИКТ: " + (peak == 0
                            ? "ТИШИНА — устройство не отдаёт данные и нативно"
                            : (avgAll < 40
                                ? "ОЧЕНЬ ТИХО — данные есть, но уровень мизерный"
                                : "ЗВУК ЕСТЬ — нативный путь работает")));

                    try { record.stop(); } catch (Exception ignored) { }
                } catch (Exception e) {
                    append("исключение: " + e.getClass().getSimpleName() + " " + e.getMessage());
                } finally {
                    try { record.release(); } catch (Exception ignored) { }
                    running = false;
                }
            }
        }, "audio-probe");
        worker.start();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) {
            try { worker.interrupt(); } catch (Exception ignored) { }
            worker = null;
        }
        super.onDestroy();
    }
}
