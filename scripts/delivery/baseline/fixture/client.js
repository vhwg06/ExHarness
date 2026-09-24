const form = document.querySelector('#new-request');
const list = document.querySelector('#requests');
const error = document.querySelector('#error');
async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? 'Request failed');
  return data;
}
function showError(message = '') { error.textContent = message; }
async function refresh() {
  const rows = await request('/requests');
  list.replaceChildren();
  for (const row of rows) {
    const item = document.createElement('li');
    const title = document.createElement('input');
    title.setAttribute('aria-label', `Title ${row.id}`);
    title.value = row.title;
    const description = document.createElement('textarea');
    description.setAttribute('aria-label', `Description ${row.id}`);
    description.value = row.description;
    const status = document.createElement('select');
    status.setAttribute('aria-label', `Status ${row.id}`);
    for (const value of ['OPEN', 'CLOSED']) {
      const option = document.createElement('option'); option.value = value; option.textContent = value; status.append(option);
    }
    status.value = row.status;
    const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save';
    save.addEventListener('click', async () => {
      try {
        const proposed = title.value.trim();
        if (window.FIXTURE_FAULT !== 'NORM-01' && (proposed.length === 0 || [...proposed].length > 120))
          throw new Error('Title must contain 1 to 120 characters');
        await request(`/requests/${row.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: proposed, description: description.value, status: status.value }) });
        showError(); await refresh();
      } catch (cause) { showError(cause.message); }
    });
    item.append(title, description, status, save); list.append(item);
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const title = form.querySelector('#title').value.trim();
    if (window.FIXTURE_FAULT !== 'NORM-01' && (title.length === 0 || [...title].length > 120))
      throw new Error('Title must contain 1 to 120 characters');
    await request('/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, description: form.querySelector('#description').value }) });
    form.reset(); showError(); await refresh();
  } catch (cause) { showError(cause.message); }
});
refresh().catch(cause => showError(cause.message));
