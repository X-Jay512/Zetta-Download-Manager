(function () {
const zdm = window.zdm;
const params = new URLSearchParams(location.search);
const id = params.get('id');
const name = params.get('name') || 'this file';
document.getElementById('file-name').textContent = name;
document.title = name;
document.getElementById('btn-ok').addEventListener('click', () => {
  zdm.send('refresh:accept', id);
});
document.getElementById('btn-cancel').addEventListener('click', () => {
  zdm.send('refresh:decline', id);
});
})();
