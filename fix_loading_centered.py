#!/usr/bin/env python3
"""
Fix showLoadingScreen() — restore 2.5s animation, render on document.body (centered).
Uses exact string replacement instead of regex.
"""

APP = '/var/www/asgard-crm/public/assets/js/app.js'

with open(APP, 'r') as f:
    app = f.read()

# Backup
with open(APP + '.bak_loading2', 'w') as f:
    f.write(app)

OLD = """  async function showLoadingScreen(){
    // v8.8.5: skip loading screen, go straight to home
    location.hash = "#/home";

    // Post-login: save username for biometric, init push, show biometric prompt
    try {
      if (loginState.login && window.AsgardWebAuthn) {
        AsgardWebAuthn.saveLastUsername(loginState.login);
      }
    } catch(e) {}
    try { if (window.AsgardPush) AsgardPush.init(); } catch(e) {}
    try { if (window.AsgardWebAuthn) AsgardWebAuthn.showRegistrationPrompt(); } catch(e) {}
    try { if (window.AsgardSessionGuard) AsgardSessionGuard.init(); } catch(e) { console.warn("[SessionGuard] init error:", e); }
  }"""

NEW = '''  async function showLoadingScreen(){
    // v8.8.5a: centered loading overlay on document.body
    var overlay = document.createElement('div');
    overlay.id = 'asgard-loading-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);';
    var q = LOADING_QUOTES[Math.floor(Math.random() * LOADING_QUOTES.length)];
    overlay.innerHTML = '<div style="text-align:center;padding:20px;">'
      + '<img src="' + ASSETS_BASE + 'img/logo.png" style="width:80px;height:80px;border-radius:20px;margin-bottom:24px;animation:pulse 2s ease-in-out infinite;" onerror="this.style.display=\\\'none\\\'">'
      + '<div style="position:relative;width:60px;height:60px;margin:0 auto 24px;">'
      + '<div style="position:absolute;inset:0;border:3px solid rgba(255,255,255,0.1);border-top-color:#e2b340;border-radius:50%;animation:spin 1s linear infinite;"></div>'
      + '<div style="position:absolute;inset:6px;border:3px solid rgba(255,255,255,0.1);border-bottom-color:#4fc3f7;border-radius:50%;animation:spin 1.5s linear infinite reverse;"></div>'
      + '</div>'
      + '<div style="color:rgba(255,255,255,0.7);font-size:13px;max-width:260px;line-height:1.5;font-style:italic;">' + esc(q) + '</div>'
      + '<div style="margin-top:16px;color:rgba(255,255,255,0.3);font-size:11px;letter-spacing:3px;">ASGARD</div>'
      + '</div>';
    document.body.appendChild(overlay);
    if (!document.getElementById('asgard-loading-keyframes')) {
      var st = document.createElement('style');
      st.id = 'asgard-loading-keyframes';
      st.textContent = '@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.7;transform:scale(0.95)}}';
      document.head.appendChild(st);
    }
    await new Promise(function(resolve){ setTimeout(resolve, 2500); });
    var ov = document.getElementById('asgard-loading-overlay');
    if (ov) ov.remove();
    location.hash = "#/home";
    // Post-login init
    try {
      if (loginState.login && window.AsgardWebAuthn) {
        AsgardWebAuthn.saveLastUsername(loginState.login);
      }
    } catch(e) {}
    try { if (window.AsgardPush) AsgardPush.init(); } catch(e) {}
    try { if (window.AsgardWebAuthn) AsgardWebAuthn.showRegistrationPrompt(); } catch(e) {}
    try { if (window.AsgardSessionGuard) AsgardSessionGuard.init(); } catch(e) { console.warn("[SessionGuard] init error:", e); }
  }'''

if OLD not in app:
    print("[ERROR] Old function text not found! Checking...")
    idx = app.find("async function showLoadingScreen()")
    if idx >= 0:
        print(f"[INFO] Function found at char {idx}")
        print(f"[INFO] Context: {repr(app[idx:idx+300])}")
    else:
        print("[ERROR] Function not found at all!")
    exit(1)

app = app.replace(OLD, NEW, 1)
print("[OK] Function replaced")

with open(APP, 'w') as f:
    f.write(app)

import subprocess
r = subprocess.run(['node', '-c', APP], capture_output=True, text=True, timeout=10)
if r.returncode == 0:
    print("[OK] Syntax check PASSED")
else:
    print(f"[FAIL] Syntax: {r.stderr[:300]}")
    import shutil
    shutil.copy(APP + '.bak_loading2', APP)
    print("[RESTORED] Backup restored")
    exit(1)

# Update cache buster
INDEX = '/var/www/asgard-crm/public/index.html'
with open(INDEX, 'r') as f:
    idx = f.read()
import re
idx = re.sub(r'app\.js\?v=[^"\'&]*', 'app.js?v=8.8.5b', idx)
with open(INDEX, 'w') as f:
    f.write(idx)
print("[OK] Cache buster updated to 8.8.5b")

print("\nDone! Restart: systemctl restart asgard-crm")
