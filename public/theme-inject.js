/* legacy injector retired — Seren ThemeModal is the real picker now */
(function(){try{localStorage.removeItem('aries-theme');localStorage.removeItem('aries-accent');}catch(e){}
var st=document.getElementById('aries-theme-x');if(st)st.remove();
function clean(){var b=document.querySelector('[data-aries-theme-row]');if(b&&b.closest('div')&&b.parentElement.children.length>2){}var p=document.getElementById('aries-theme-pick');if(p)p.remove();}
document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('[data-aries-theme-btn]'))e.stopPropagation();},true);})();
