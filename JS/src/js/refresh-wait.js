const params = new URLSearchParams(location.search);
const name = params.get('name') || 'this file';
document.getElementById('file-name').textContent = name;
document.title = name;
document.getElementById('btn-stop').addEventListener('click', () => {
  if (window.zdm) window.zdm.send('refresh:stop');
  window.close();
});
