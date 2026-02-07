/**
 * ASGARD Auth — Серверная версия v2.0
 * - JWT авторизация через сервер
 * - Без IndexedDB
 */

window.AsgardAuth = (function(){
  
  const ROLES = {
    ADMIN:1, TO:1, PM:1, HR:1, BUH:1, OFFICE_MANAGER:1,
    DIRECTOR_COMM:1, DIRECTOR_GEN:1, DIRECTOR_DEV:1, PROC:1, WAREHOUSE:1,
    HEAD_TO:1, HEAD_PM:1, CHIEF_ENGINEER:1, HR_MANAGER:1
  };
  
  const DIRECTOR_ROLES = ["DIRECTOR_COMM","DIRECTOR_GEN","DIRECTOR_DEV"];
  
  function isDirectorRole(role){
    const r = String(role||"");
    return r === "ADMIN" || DIRECTOR_ROLES.includes(r);
  }
  
  function normalizeUserRoles(user){
    const primary = String(user?.role||"");
    let roles = Array.isArray(user?.roles) ? user.roles.slice() : (primary ? [primary] : []);
    if(primary && !roles.includes(primary)) roles.push(primary);
    // Наследование ролей (M15)
    if(primary==="DIRECTOR_DEV" && !roles.includes("PM")) roles.push("PM");
    if(primary==="HR" && !roles.includes("PM")) roles.push("PM");
    if(primary==="HEAD_TO" && !roles.includes("TO")) roles.push("TO");
    if(primary==="HEAD_PM" && !roles.includes("PM")) roles.push("PM");
    if(primary==="HR_MANAGER" && !roles.includes("HR")) roles.push("HR");
    if(primary==="CHIEF_ENGINEER" && !roles.includes("WAREHOUSE")) roles.push("WAREHOUSE");
    return [...new Set(roles)];
  }
  
  function roleTitle(role){
    const map = {
      ADMIN:"Администратор", TO:"ТО", PM:"РП", HR:"HR", BUH:"Бухгалтер",
      OFFICE_MANAGER:"Офис-менеджер", WAREHOUSE:"Кладовщик",
      DIRECTOR_COMM:"Ком. директор", DIRECTOR_GEN:"Ген. директор",
      DIRECTOR_DEV:"Тех. директор", PROC:"Закупщик",
      HEAD_TO:"Рук. тендерного отдела", HEAD_PM:"Рук. ТО",
      CHIEF_ENGINEER:"Главный инженер", HR_MANAGER:"HR-менеджер"
    };
    return map[role] || role;
  }
  
  function generateTempPassword(){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pass = '';
    for(let i = 0; i < 8; i++){
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
  }
  
  // ============================================
  // ПОЛУЧЕНИЕ ТОКЕНА И ПОЛЬЗОВАТЕЛЯ
  // ============================================
  function getAuth(){
    const token = localStorage.getItem('asgard_token');
    const userStr = localStorage.getItem('asgard_user');
    if(token && userStr){
      try {
        const user = JSON.parse(userStr);
        user.roles = normalizeUserRoles(user);
        return { token, user, session: { user_id: user.id, token } };
      } catch(e) {}
    }
    return null;
  }
  
  function getSession(){
    const auth = getAuth();
    if(auth) return auth.session;
    return null;
  }
  
  // ============================================
  // ВХОД: Шаг 1 — проверка логина/пароля
  // ============================================
  async function loginStep1({login, password}){
    login = String(login||"").trim();
    
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password })
    });
    const data = await resp.json();
    
    if (!resp.ok) {
      throw new Error(data.error || data.message || 'Неверный логин или пароль');
    }
    
    // Сохраняем токен
    localStorage.setItem('asgard_token', data.token);
    localStorage.setItem('asgard_user', JSON.stringify(data.user));

    // M1: Сохраняем пермишены и настройки меню
    if (data.user.permissions) {
      localStorage.setItem('asgard_permissions', JSON.stringify(data.user.permissions));
    }
    if (data.user.menu_settings) {
      localStorage.setItem('asgard_menu_settings', JSON.stringify(data.user.menu_settings));
    }

    // Проверяем статус от сервера
    if(data.status === 'need_setup' || data.user.must_change_password){
      return { status: 'need_setup', userId: data.user.id, userName: data.user.name };
    }

    if(data.status === 'need_pin'){
      return { status: 'need_pin', userId: data.user.id, userName: data.user.name };
    }

    return { status: 'ok', user: data.user, token: data.token };
  }
  
  // ============================================
  // ВХОД: Шаг 2 — установка нового пароля и PIN
  // ============================================
  async function setupCredentials({userId, newPassword, pin}){
    if(!newPassword || newPassword.length < 6) throw new Error("Пароль минимум 6 символов");
    if(!pin || !/^\d{4}$/.test(pin)) throw new Error("PIN должен быть 4 цифры");
    
    const auth = getAuth();
    const resp = await fetch('/api/auth/setup-credentials', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (auth?.token || '')
      },
      body: JSON.stringify({ userId, newPassword, pin })
    });
    
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || data.message || 'Ошибка');
    }
    
    if(data.token) localStorage.setItem('asgard_token', data.token);
    if(data.user) {
      localStorage.setItem('asgard_user', JSON.stringify(data.user));
      // M1: Сохраняем пермишены и настройки меню
      if (data.user.permissions) {
        localStorage.setItem('asgard_permissions', JSON.stringify(data.user.permissions));
      }
      if (data.user.menu_settings) {
        localStorage.setItem('asgard_menu_settings', JSON.stringify(data.user.menu_settings));
      }
    }

    return data;
  }

  // ============================================
  // ПРОВЕРКА PIN
  // ============================================
  async function verifyPin({userId, pin, remember}){
    if(!pin || !/^\d{4}$/.test(pin)) throw new Error("PIN должен быть 4 цифры");
    
    const auth = getAuth();
    const resp = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (auth?.token || '')
      },
      body: JSON.stringify({ userId, pin, remember })
    });
    
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || data.message || 'Неверный PIN');

    // M1: Сохраняем токен, пермишены и настройки меню после верификации PIN
    if(data.token) localStorage.setItem('asgard_token', data.token);
    if(data.user) {
      localStorage.setItem('asgard_user', JSON.stringify(data.user));
      if (data.user.permissions) {
        localStorage.setItem('asgard_permissions', JSON.stringify(data.user.permissions));
      }
      if (data.user.menu_settings) {
        localStorage.setItem('asgard_menu_settings', JSON.stringify(data.user.menu_settings));
      }
    }

    return data;
  }

  // ============================================
  // СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ
  // ============================================
  async function createUser(userData, creatorUserId){
    const auth = getAuth();
    const resp = await fetch('/api/users', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (auth?.token || '')
      },
      body: JSON.stringify(userData)
    });
    
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || data.message || 'Ошибка создания');
    return data;
  }
  
  // ============================================
  // БЛОКИРОВКА/РАЗБЛОКИРОВКА
  // ============================================
  async function blockUser(targetUserId, actorUserId, reason){
    const auth = getAuth();
    const resp = await fetch('/api/users/' + targetUserId + '/block', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (auth?.token || '')
      },
      body: JSON.stringify({ reason })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Ошибка');
    return data;
  }
  
  async function unblockUser(targetUserId, actorUserId){
    const auth = getAuth();
    const resp = await fetch('/api/users/' + targetUserId + '/unblock', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (auth?.token || '') }
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Ошибка');
    return data;
  }
  
  // ============================================
  // СБРОС ПАРОЛЯ
  // ============================================
  async function resetPassword(targetUserId, actorUserId){
    const auth = getAuth();
    const resp = await fetch('/api/auth/send-telegram-password', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (auth?.token || '')
      },
      body: JSON.stringify({ userId: targetUserId })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Ошибка');
    return data;
  }
  
  // ============================================
  // СМЕНА ПАРОЛЯ
  // ============================================
  async function changePassword({userId, oldPassword, newPassword}){
    const auth = getAuth();
    const resp = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (auth?.token || '')
      },
      body: JSON.stringify({ oldPassword, newPassword })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Ошибка');
    return true;
  }
  
  // ============================================
  // СМЕНА PIN
  // ============================================
  async function changePin({userId, password, newPin}){
    const auth = getAuth();
    const resp = await fetch('/api/auth/change-pin', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (auth?.token || '')
      },
      body: JSON.stringify({ password, newPin })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Ошибка');
    return true;
  }
  
  // ============================================
  // ВЫХОД
  // ============================================
  function logout(){
    localStorage.removeItem('asgard_token');
    localStorage.removeItem('asgard_user');
    localStorage.removeItem('asgard_permissions');
    localStorage.removeItem('asgard_menu_settings');
    sessionStorage.clear();
  }

  // ============================================
  // M1: ПЕРМИШЕНЫ — МОДУЛЬНЫЕ РОЛИ
  // ============================================
  function getPermissions() {
    try {
      return JSON.parse(localStorage.getItem('asgard_permissions') || '{}');
    } catch(e) { return {}; }
  }

  function hasPermission(moduleKey, operation = 'read') {
    const auth = getAuth();
    if (!auth || !auth.user) return false;
    if (auth.user.role === 'ADMIN') return true;
    const perms = getPermissions();
    const p = perms[moduleKey];
    if (!p) return false;
    if (operation === 'read') return p.read;
    if (operation === 'write') return p.write;
    if (operation === 'delete') return p.delete;
    return false;
  }

  function getMenuSettings() {
    try {
      return JSON.parse(localStorage.getItem('asgard_menu_settings') || '{}');
    } catch(e) { return {}; }
  }
  
  // ============================================
  // ПРОВЕРКА СЕССИИ
  // ============================================
  async function requireUser(){
    const auth = getAuth();
    if(!auth || !auth.token || !auth.user) return null;
    
    try {
      const resp = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      
      if(!resp.ok){
        logout();
        return null;
      }
      
      const data = await resp.json();
      const user = data.user || auth.user;
      user.roles = normalizeUserRoles(user);
      user.active_role = user.role;

      localStorage.setItem('asgard_user', JSON.stringify(user));

      // M1: Обновляем пермишены и настройки меню
      if (user.permissions) {
        localStorage.setItem('asgard_permissions', JSON.stringify(user.permissions));
      }
      if (user.menu_settings) {
        localStorage.setItem('asgard_menu_settings', JSON.stringify(user.menu_settings));
      }

      return { session: { user_id: user.id, token: auth.token }, user, token: auth.token };
    } catch(e) {
      // При ошибке сети - используем кэш
      const user = auth.user;
      user.roles = normalizeUserRoles(user);
      user.active_role = user.role;
      return { session: { user_id: user.id, token: auth.token }, user, token: auth.token };
    }
  }
  
  // ============================================
  // ПЕРЕКЛЮЧЕНИЕ РОЛИ
  // ============================================
  async function setActiveRole(role){
    const auth = getAuth();
    if(!auth) return false;
    
    const user = auth.user;
    const roles = normalizeUserRoles(user);
    if(!roles.includes(role)) return false;
    
    user.active_role = role;
    user.role = role;
    localStorage.setItem('asgard_user', JSON.stringify(user));
    return true;
  }
  
  function getActiveRole(){
    const auth = getAuth();
    return auth?.user?.active_role || auth?.user?.role || null;
  }
  
  function getMyRoles(){
    const auth = getAuth();
    return normalizeUserRoles(auth?.user);
  }
  
  function canSwitch(user){
    const roles = normalizeUserRoles(user);
    const hasPM = roles.includes("PM");
    if(hasPM && roles.includes("DIRECTOR_DEV")) return {kind:"director_pm", a:"DIRECTOR_DEV", b:"PM"};
    if(hasPM && roles.includes("HR")) return {kind:"hr_pm", a:"HR", b:"PM"};
    return null;
  }
  
  async function _testLogin(login){
    return await loginStep1({ login, password: 'admin123' });
  }
  
  return {
    ROLES,
    DIRECTOR_ROLES,
    isDirectorRole,
    normalizeUserRoles,
    roleTitle,
    generateTempPassword,
    getAuth,
    getSession,
    loginStep1,
    setupCredentials,
    verifyPin,
    createUser,
    blockUser,
    unblockUser,
    resetPassword,
    changePassword,
    changePin,
    logout,
    requireUser,
    setActiveRole,
    getActiveRole,
    getMyRoles,
    canSwitch,
    getPermissions,
    hasPermission,
    getMenuSettings,
    _testLogin
  };
})();
