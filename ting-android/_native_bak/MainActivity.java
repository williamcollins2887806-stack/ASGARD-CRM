package com.asgard.ting.room;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

/**
 * Ting TV — grant WebView cam/mic (LiveKit getUserMedia) + runtime permissions.
 */
public class MainActivity extends BridgeActivity {
    private static final int REQ_AV = 4201;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestAvPermissions();
        wireWebRtcChromeClient();
    }

    private void requestAvPermissions() {
        List<String> need = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.CAMERA);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!need.isEmpty()) {
            ActivityCompat.requestPermissions(this, need.toArray(new String[0]), REQ_AV);
        }
    }

    private void wireWebRtcChromeClient() {
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) return;
            final WebChromeClient existing = webView.getWebChromeClient();
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> {
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                request.grant(request.getResources());
                            }
                        } catch (Exception e) {
                            try {
                                if (existing != null) existing.onPermissionRequest(request);
                            } catch (Exception ignored) { /* */ }
                        }
                    });
                }

                @Override
                public void onPermissionRequestCanceled(PermissionRequest request) {
                    if (existing != null) existing.onPermissionRequestCanceled(request);
                }
            });
        } catch (Exception ignored) { /* bridge not ready */ }
    }

    @Override
    public void onStart() {
        super.onStart();
        wireWebRtcChromeClient();
    }
}
