const STORAGE_KEY = 'friends-list-builder-v1';
const friends = [];
const addForm = document.querySelector('#add-form');
const fullNameInput = document.querySelector('#full-name');
const usernameInput = document.querySelector('#username');
const peopleList = document.querySelector('#people-list');
const peopleCount = document.querySelector('#builder-people-count');
const emptyState = document.querySelector('#empty-state');
const listStatus = document.querySelector('#list-status');
const searchInput = document.querySelector('#search-input');
const downloadButton = document.querySelector('#download-button');
const importInput = document.querySelector('#import-input');
const saveStatus = document.querySelector('#save-status');
const dialog = document.querySelector('#connections-dialog');
const connectionOptions = document.querySelector('#connection-options');
const connectionSearch = document.querySelector('#connection-search');
const connectionCount = document.querySelector('#connection-selection-count');
const dialogSubtitle = document.querySelector('#dialog-subtitle');
let editingFriendId = null;
let draftMutuals = new Set();

function createId(usedIds = new Set(friends.map(friend => friend.id))) {
  let id;
  do {
    id = `friend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  } while (usedIds.has(id));
  return id;
}

function normalizeUsername(value) {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

function nameInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '•';
}

function setListStatus(message, isError = false) {
  listStatus.textContent = message;
  listStatus.style.color = isError ? '#ff9b91' : '';
}

function saveFriends() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makeSummary()));
    saveStatus.textContent = 'Your list is saved in this browser automatically.';
  } catch (error) {
    saveStatus.textContent = `This browser could not save your list locally: ${error.message}`;
  }
  document.dispatchEvent(new CustomEvent('friends-list-updated', { detail: makeSummary() }));
}

function getMutualCount(friend) {
  return friend.mutuals.size;
}

function renderFriends() {
  const query = searchInput.value.trim().toLowerCase();
  const visibleFriends = friends.filter(friend =>
    friend.full_name.toLowerCase().includes(query) || friend.username.toLowerCase().includes(query)
  );
  peopleCount.textContent = friends.length;
  emptyState.hidden = friends.length > 0;
  downloadButton.disabled = friends.length === 0;
  peopleList.replaceChildren();

  for (const friend of visibleFriends) {
    const row = document.createElement('article');
    row.className = 'person-row';

    const avatar = document.createElement('span');
    avatar.className = 'person-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = nameInitials(friend.full_name);

    const details = document.createElement('div');
    details.className = 'person-details';
    const name = document.createElement('strong');
    name.textContent = friend.full_name;
    const username = document.createElement('span');
    username.textContent = `@${friend.username}`;
    details.append(name, username);

    const mutuals = document.createElement('span');
    mutuals.className = 'mutual-count';
    const mutualCount = getMutualCount(friend);
    mutuals.textContent = `${mutualCount} mutual${mutualCount === 1 ? '' : 's'}`;

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const connectButton = document.createElement('button');
    connectButton.className = 'small-action';
    connectButton.type = 'button';
    connectButton.textContent = 'Connections';
    connectButton.setAttribute('aria-label', `Edit mutual connections for ${friend.full_name}`);
    connectButton.addEventListener('click', () => openConnections(friend.id));

    const removeButton = document.createElement('button');
    removeButton.className = 'small-action danger';
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.setAttribute('aria-label', `Remove ${friend.full_name}`);
    removeButton.addEventListener('click', () => removeFriend(friend.id));
    actions.append(connectButton, removeButton);

    row.append(avatar, details, mutuals, actions);
    peopleList.append(row);
  }

  if (friends.length > 0 && visibleFriends.length === 0) {
    const noResults = document.createElement('p');
    noResults.className = 'no-connections';
    noResults.textContent = 'No people match your search.';
    peopleList.append(noResults);
  }
}

function addFriend(fullName, username) {
  const cleanName = fullName.trim().replace(/\s+/g, ' ');
  const cleanUsername = normalizeUsername(username);
  if (!cleanName || !cleanUsername) {
    setListStatus('Enter both a name and username.', true);
    return false;
  }
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(cleanUsername)) {
    setListStatus('Usernames can use letters, numbers, periods, and underscores.', true);
    return false;
  }
  if (friends.some(friend => friend.username === cleanUsername)) {
    setListStatus(`@${cleanUsername} is already on your list.`, true);
    usernameInput.focus();
    return false;
  }

  friends.push({
    id: createId(),
    full_name: cleanName,
    username: cleanUsername,
    mutuals: new Set()
  });
  setListStatus('');
  saveFriends();
  renderFriends();
  return true;
}

function removeFriend(id) {
  const friend = friends.find(person => person.id === id);
  if (!friend) return;
  const index = friends.indexOf(friend);
  friends.splice(index, 1);
  for (const other of friends) other.mutuals.delete(id);
  setListStatus(`${friend.full_name} was removed, along with their mutual links.`);
  saveFriends();
  renderFriends();
}

function updateConnectionCount() {
  connectionCount.textContent = `${draftMutuals.size} selected`;
}

function renderConnectionOptions() {
  const query = connectionSearch.value.trim().toLowerCase();
  const candidates = friends.filter(friend =>
    friend.id !== editingFriendId &&
    (friend.full_name.toLowerCase().includes(query) || friend.username.toLowerCase().includes(query))
  );
  connectionOptions.replaceChildren();

  if (candidates.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'no-connections';
    empty.textContent = friends.length < 2
      ? 'Add at least one more person to create a connection.'
      : 'No people match your search.';
    connectionOptions.append(empty);
    return;
  }

  for (const friend of candidates) {
    const label = document.createElement('label');
    label.className = 'connection-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = draftMutuals.has(friend.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) draftMutuals.add(friend.id);
      else draftMutuals.delete(friend.id);
      updateConnectionCount();
    });

    const avatar = document.createElement('span');
    avatar.className = 'person-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = nameInitials(friend.full_name);
    const details = document.createElement('span');
    details.className = 'person-details';
    const name = document.createElement('strong');
    name.textContent = friend.full_name;
    const username = document.createElement('span');
    username.textContent = `@${friend.username}`;
    details.append(name, username);
    label.append(checkbox, avatar, details);
    connectionOptions.append(label);
  }
}

function openConnections(id) {
  const friend = friends.find(person => person.id === id);
  if (!friend) return;
  editingFriendId = id;
  draftMutuals = new Set(friend.mutuals);
  dialogSubtitle.textContent = `Choose who ${friend.full_name} knows. Connections are added both ways.`;
  connectionSearch.value = '';
  updateConnectionCount();
  renderConnectionOptions();
  dialog.showModal();
  connectionSearch.focus();
}

function saveConnections() {
  const friend = friends.find(person => person.id === editingFriendId);
  if (!friend) return;
  const changedIds = new Set([...friend.mutuals, ...draftMutuals]);
  for (const otherId of changedIds) {
    const other = friends.find(person => person.id === otherId);
    if (!other) continue;
    if (draftMutuals.has(otherId)) other.mutuals.add(friend.id);
    else other.mutuals.delete(friend.id);
  }
  friend.mutuals = new Set(draftMutuals);
  setListStatus(`Connections updated for ${friend.full_name}.`);
  saveFriends();
  renderFriends();
}

function parseFriendList(data) {
  const importedFriends = Array.isArray(data) ? data : data?.friends;
  if (!Array.isArray(importedFriends)) {
    throw new Error('The JSON must be an array of people or contain a "friends" array.');
  }

  const imported = [];
  const byUsername = new Map();
  const byId = new Map();
  const usedIds = new Set();
  for (const raw of importedFriends) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Every friend entry must be an object.');
    }
    const username = normalizeUsername(typeof raw.username === 'string' ? raw.username : '');
    const fullName = String(raw.full_name ?? raw.name ?? username).trim();
    if (!username || !fullName || !/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
      throw new Error('Each friend needs a name and a valid username.');
    }
    if (byUsername.has(username)) throw new Error(`The imported list has duplicate username @${username}.`);
    const oldId = raw.pk ?? raw.id;
    const id = oldId == null ? createId(usedIds) : String(oldId);
    if (usedIds.has(id)) throw new Error(`The imported list has duplicate id ${id}.`);
    usedIds.add(id);
    const friend = { id, full_name: fullName, username, mutuals: new Set() };
    imported.push({ friend, rawMutuals: Array.isArray(raw.mutuals) ? raw.mutuals : [] });
    byUsername.set(username, friend);
    if (oldId != null) byId.set(String(oldId), friend);
  }

  for (const { friend, rawMutuals } of imported) {
    for (const mutual of rawMutuals) {
      const mutualUsername = typeof mutual === 'string' ? normalizeUsername(mutual) : normalizeUsername(mutual?.username || '');
      const mutualId = mutual && typeof mutual === 'object' ? mutual.id ?? mutual.pk : null;
      const target = mutualUsername ? byUsername.get(mutualUsername) : mutualId == null ? null : byId.get(String(mutualId));
      if (target && target.id !== friend.id) {
        friend.mutuals.add(target.id);
        target.mutuals.add(friend.id);
      }
    }
  }
  return imported.map(entry => entry.friend);
}

async function importFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = parseFriendList(parsed);
    friends.splice(0, friends.length, ...imported);
    setListStatus(`Imported ${friends.length} ${friends.length === 1 ? 'person' : 'people'}.`);
    saveFriends();
    renderFriends();
  } catch (error) {
    setListStatus(error instanceof SyntaxError ? 'Could not read that file as valid JSON.' : error.message, true);
  } finally {
    importInput.value = '';
  }
}

function makeSummary() {
  const usernames = friends.map(friend => friend.username);
  return {
    notFollowers: [],
    notFollowingBack: [],
    followersUsernames: usernames,
    followingUsernames: [...usernames],
    friends: friends.map(friend => ({
      pk: friend.id,
      full_name: friend.full_name,
      username: friend.username,
      mutuals: [...friend.mutuals]
        .map(id => friends.find(person => person.id === id))
        .filter(Boolean)
        .map(person => ({ id: person.id, username: person.username }))
    }))
  };
}

function downloadSummary() {
  if (friends.length === 0) return;
  const file = new Blob([`${JSON.stringify(makeSummary(), null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'friends-summary.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setListStatus('Downloaded friends-summary.json.');
}

addForm.addEventListener('submit', event => {
  event.preventDefault();
  if (addFriend(fullNameInput.value, usernameInput.value)) {
    addForm.reset();
    fullNameInput.focus();
  }
});
searchInput.addEventListener('input', renderFriends);
connectionSearch.addEventListener('input', renderConnectionOptions);
importInput.addEventListener('change', () => importFile(importInput.files[0]));
document.addEventListener('friends-list-imported', event => {
  try {
    const imported = parseFriendList(event.detail);
    friends.splice(0, friends.length, ...imported);
    setListStatus(`Imported ${friends.length} ${friends.length === 1 ? 'person' : 'people'}.`);
    saveFriends();
    renderFriends();
  } catch (error) {
    setListStatus(error.message, true);
    document.dispatchEvent(new CustomEvent('friends-list-import-error', { detail: error.message }));
  }
});
downloadButton.addEventListener('click', downloadSummary);
document.querySelector('#connections-form').addEventListener('submit', event => {
  event.preventDefault();
  saveConnections();
  dialog.close();
});
document.querySelector('#cancel-connections').addEventListener('click', () => dialog.close());
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    friends.push(...parseFriendList(JSON.parse(saved)));
    saveStatus.textContent = 'Restored your saved list from this browser.';
  }
} catch (error) {
  saveStatus.textContent = `Could not restore the saved list: ${error.message}`;
}
renderFriends();
