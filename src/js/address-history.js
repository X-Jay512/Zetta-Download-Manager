(function () {
const zdm = window.zdm;
const list = document.getElementById('list');

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

async function init() {
  let urls = [];
  try {
    const saved = await zdm.invoke('app:get-address-history');
    urls = Array.isArray(saved) ? saved : [];
  } catch {
    urls = [];
  }
  urls.forEach((url) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = url;
    btn.title = url;
    btn.addEventListener('click', () => zdm.send('address:history-pick', url));
    list.appendChild(btn);
  });
}

init();
})();
