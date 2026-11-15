package com.calldosgames.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;

import java.util.ArrayList;
import java.util.List;

/** App de celular do Call dos Games: abre o site numa tela própria, com microfone, câmera e envio de arquivos. */
public class MainActivity extends Activity {
    static final String HOST = "call-dos-games.vercel.app";
    static final String HOME = "https://" + HOST + "/app";
    static final int REQ_PERM = 1;
    static final int REQ_FILE = 2;

    WebView web;
    PermissionRequest pending;
    ValueCallback<Uri[]> fileCb;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#1f2023"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " CallDosGamesAndroid/" + BuildInfo.VERSION);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Ponte(), "cdgAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost()) || "file".equals(u.getScheme())) return false;
                abrirFora(u);
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) v.loadUrl("file:///android_asset/offline.html");
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(() -> pedirPermissao(req));
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(p.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(urlDoIntent(getIntent()));
    }

    String urlDoIntent(Intent i) {
        Uri d = i == null ? null : i.getData();
        if (d != null && HOST.equals(d.getHost())) return d.toString();
        return HOME;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (i.getData() != null) web.loadUrl(urlDoIntent(i));
    }

    void abrirFora(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    void pedirPermissao(PermissionRequest req) {
        Uri o = req.getOrigin();
        if (o == null || !HOST.equals(o.getHost())) {
            req.deny();
            return;
        }
        List<String> faltam = new ArrayList<>();
        for (String r : req.getResources()) {
            String p = permissaoDe(r);
            if (p != null && checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED && !faltam.contains(p)) faltam.add(p);
        }
        if (faltam.isEmpty()) {
            conceder(req);
            return;
        }
        if (pending != null) pending.deny();
        pending = req;
        requestPermissions(faltam.toArray(new String[0]), REQ_PERM);
    }

    static String permissaoDe(String recurso) {
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(recurso)) return Manifest.permission.RECORD_AUDIO;
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(recurso)) return Manifest.permission.CAMERA;
        return null;
    }

    void conceder(PermissionRequest req) {
        List<String> ok = new ArrayList<>();
        for (String r : req.getResources()) {
            String p = permissaoDe(r);
            if (p != null && checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) ok.add(r);
        }
        if (ok.isEmpty()) req.deny();
        else req.grant(ok.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_PERM && pending != null) {
            conceder(pending);
            pending = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCb = null;
            return;
        }
        super.onActivityResult(code, result, data);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /** O site chama window.cdgAndroid.emCall(true/false) para a tela não apagar durante a call. */
    class Ponte {
        @JavascriptInterface
        public String app() {
            return "android";
        }

        @JavascriptInterface
        public void emCall(boolean sim) {
            runOnUiThread(() -> {
                if (sim) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }
}
