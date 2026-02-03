(function(){
  const KEY = "asgard_theme"; // 'dark' | 'light'
  function get(){
    try{ return (localStorage.getItem(KEY) || "dark"); }catch(e){ return "dark"; }
  }
  function apply(t){
    const theme = (t === "light") ? "light" : "dark";
    try{ document.documentElement.dataset.theme = theme; }catch(e){}
    try{ localStorage.setItem(KEY, theme); }catch(e){}
    // notify listeners
    try{ window.dispatchEvent(new CustomEvent("asgard:theme", {detail:{theme}})); }catch(e){}
    return theme;
  }
  function toggle(){
    return apply(get()==="light" ? "dark" : "light");
  }
  function init(){
    // ensure applied once on load (in case inline script missing)
    apply(get());
  }
  window.AsgardTheme = { KEY, get, apply, toggle, init };
})();