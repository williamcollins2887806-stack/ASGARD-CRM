window.AsgardSafeMode=(function(){
  const KEY="asgard_safe_mode";
  function isOn(){ return localStorage.getItem(KEY)==="1"; }
  function enable(){ localStorage.setItem(KEY,"1"); }
  function disable(){ localStorage.removeItem(KEY); }
  function toggle(){ isOn()?disable():enable(); }
  return { isOn, enable, disable, toggle, KEY };
})();
