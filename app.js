const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const statusMessage = document.querySelector('#status');
const results = document.querySelector('#results');
const canvas = document.querySelector('#graph');
const context = canvas.getContext('2d');
const tooltip = document.querySelector('#tooltip');
const downloadGraphButton = document.querySelector('#download-graph');
const graphView = document.querySelector('#graph-view');
const editorView = document.querySelector('#editor-view');
const graphWrap = document.querySelector('.graph-wrap');
const viewTabs = [...document.querySelectorAll('.view-tab')];
const visualizationSelect = document.querySelector('#visualization-select');
const focusControl = document.querySelector('#focus-control');
const focusPersonSelect = document.querySelector('#focus-person');

const palette = [
  '#c6f277', '#81d4fa', '#ffb86c', '#e89cff', '#ff8585',
  '#69e0bf', '#f3da70', '#9ea8ff', '#ff9fcf', '#a6df8a',
  '#f0996b', '#8bd5ca', '#cab2ff', '#d7e26b', '#7ca9ff'
];
let graph = null;
let resizeObserver = null;
let graphLayoutReady = false;
let visualizationMode = 'force';
let focusedNodeIndex = 0;
const viewTransform = { scale: 1, x: 0, y: 0 };

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
}

function getFriendName(friend) {
  return friend.full_name || friend.name || friend.username || String(friend.pk ?? friend.id ?? 'Unknown');
}

function getLayoutSeed(nodes, edges) {
  const values = [
    ...nodes.map(node => node.id).sort(),
    ...edges.map(([from, to]) => {
      const endpoints = [nodes[from].id, nodes[to].id].sort();
      return `${endpoints[0]}:${endpoints[1]}`;
    }).sort()
  ];
  let hash = 2166136261;
  for (const value of values) {
    for (let index = 0; index < value.length; index++) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    }
    hash = Math.imul(hash ^ 0, 16777619);
  }
  return hash >>> 0 || 1;
}

function buildGraph(data) {
  const friends = Array.isArray(data) ? data : data?.friends;
  if (!Array.isArray(friends)) {
    throw new Error('The JSON must be a friends array or an object containing a friends array.');
  }

  const nodes = [];
  const byUsername = new Map();
  const byId = new Map();
  let duplicatesRemoved = 0;

  for (const friend of friends) {
    if (!friend || typeof friend !== 'object' || Array.isArray(friend)) {
      throw new Error('Every friend must be a JSON object.');
    }
    const username = typeof friend.username === 'string' ? friend.username.trim().toLowerCase() : '';
    const id = friend.pk ?? friend.id;
    if (!username && id == null) {
      throw new Error('Each friend needs at least a username or id.');
    }

    const usernameIndex = username ? byUsername.get(username) : undefined;
    const idIndex = id != null ? byId.get(String(id)) : undefined;
    const existingIndex = usernameIndex ?? idIndex;
    if (existingIndex !== undefined) {
      duplicatesRemoved++;
      if (Array.isArray(friend.mutuals)) nodes[existingIndex].mutuals.push(...friend.mutuals);
      if (username) byUsername.set(username, existingIndex);
      if (id != null) byId.set(String(id), existingIndex);
      continue;
    }

    const node = {
      id: id == null ? username : String(id),
      username: username || String(id),
      name: getFriendName(friend),
      mutualCount: 0,
      mutuals: Array.isArray(friend.mutuals) ? friend.mutuals : [],
      links: new Set(),
      community: 0,
      labelLines: getFriendName(friend).split(/\s+/).slice(0, 2),
      x: 0,
      y: 0,
      radius: 26
    };
    const index = nodes.length;
    nodes.push(node);
    if (username) byUsername.set(username, index);
    if (id != null) byId.set(String(id), index);
  }

  for (let index = 0; index < nodes.length; index++) {
    for (const mutual of nodes[index].mutuals) {
      const rawMutualUsername = typeof mutual === 'string' ? mutual : mutual?.username;
      const mutualUsername = typeof rawMutualUsername === 'string'
        ? rawMutualUsername.trim().toLowerCase()
        : '';
      const mutualId = typeof mutual === 'object' && mutual !== null
        ? mutual.id ?? mutual.pk
        : null;
      const usernameIndex = mutualUsername ? byUsername.get(mutualUsername) : undefined;
      const idIndex = mutualId != null ? byId.get(String(mutualId)) : undefined;
      const linkedIndex = usernameIndex ?? idIndex;
      if (linkedIndex !== undefined && linkedIndex !== index) {
        nodes[index].links.add(linkedIndex);
        nodes[linkedIndex].links.add(index);
      }
    }
    nodes[index].mutualCount = nodes[index].links.size;
  }

  const clusters = detectCommunities(nodes);
  const edges = [];
  for (let index = 0; index < nodes.length; index++) {
    for (const linkedIndex of nodes[index].links) {
      if (index < linkedIndex) edges.push([index, linkedIndex]);
    }
  }

  return { nodes, edges, clusters, duplicatesRemoved, layoutSeed: getLayoutSeed(nodes, edges) };
}

function detectCommunities(nodes) {
  if (nodes.length === 0) return [];
  const labels = nodes.map((_, index) => index);
  const degrees = nodes.map(node => node.links.size);
  const edgeCount = degrees.reduce((sum, degree) => sum + degree, 0) / 2;
  if (edgeCount === 0) return nodes.map((node, index) => {
    node.community = index;
    return [index];
  });

  const resolution = 1.6;
  const communityDegrees = [...degrees];
  let seed = 7919;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const order = nodes.map((_, index) => index);

  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    for (const index of order) {
      const degree = degrees[index];
      if (degree === 0) continue;

      const currentLabel = labels[index];
      const neighboringEdges = new Map();
      for (const neighbor of nodes[index].links) {
        const label = labels[neighbor];
        neighboringEdges.set(label, (neighboringEdges.get(label) || 0) + 1);
      }

      communityDegrees[currentLabel] -= degree;
      const currentScore = (neighboringEdges.get(currentLabel) || 0) -
        (resolution * degree * communityDegrees[currentLabel]) / (2 * edgeCount);
      let bestLabel = currentLabel;
      let bestScore = currentScore;

      for (const [label, internalEdges] of neighboringEdges) {
        const score = internalEdges -
          (resolution * degree * communityDegrees[label]) / (2 * edgeCount);
        if (score > bestScore + 1e-9) {
          bestLabel = label;
          bestScore = score;
        }
      }

      if (bestLabel !== currentLabel) {
        labels[index] = bestLabel;
        communityDegrees[bestLabel] += degree;
        changed = true;
      } else {
        communityDegrees[currentLabel] += degree;
      }
    }
    if (!changed) break;
  }

  const groups = new Map();
  labels.forEach((label, index) => {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(index);
  });
  const communities = [...groups.values()];

  let merged = true;
  while (merged) {
    merged = false;
    for (let firstIndex = 0; firstIndex < communities.length && !merged; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < communities.length; secondIndex++) {
        const first = communities[firstIndex];
        const second = communities[secondIndex];
        const smaller = first.length <= second.length ? first : second;
        const larger = first.length <= second.length ? second : first;
        if (smaller.length < 2) continue;

        let internalEdges = 0;
        for (const index of smaller) {
          for (const neighbor of nodes[index].links) {
            if (smaller.includes(neighbor)) internalEdges++;
          }
        }
        const density = internalEdges / (smaller.length * (smaller.length - 1));
        if (density < 0.5) continue;

        const requiredConnections = Math.ceil(smaller.length * 0.75);
        const hasStrongBridge = larger.some(index => {
          let connections = 0;
          for (const neighbor of nodes[index].links) {
            if (smaller.includes(neighbor)) connections++;
          }
          return connections >= requiredConnections;
        });
        if (!hasStrongBridge) continue;

        const mergedCommunity = [...first, ...second];
        communities.splice(secondIndex, 1);
        communities.splice(firstIndex, 1, mergedCommunity);
        merged = true;
        break;
      }
    }
  }

  communities.sort((a, b) => b.length - a.length);
  communities.forEach((members, community) => {
    for (const index of members) nodes[index].community = community;
  });
  return communities;
}

function assignClusterPositions(width, height, padding, usableWidth, usableHeight, random) {
  const { nodes, edges, clusters } = graph;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxCenterRadius = Math.max(50, Math.min(usableWidth, usableHeight) / 2 - 20);
  const layouts = clusters.map(members => ({
    members,
    radius: Math.min(maxCenterRadius, 52 + Math.sqrt(members.length) * 25),
    x: padding + random() * usableWidth,
    y: padding + random() * usableHeight
  }));

  for (let iteration = 0; iteration < 180; iteration++) {
    const forceX = new Array(layouts.length).fill(0);
    const forceY = new Array(layouts.length).fill(0);
    const cooling = 1 - iteration / 210;
    for (let i = 0; i < layouts.length; i++) {
      for (let j = i + 1; j < layouts.length; j++) {
        const first = layouts[i];
        const second = layouts[j];
        let dx = second.x - first.x;
        let dy = second.y - first.y;
        let distance = Math.hypot(dx, dy);
        if (distance === 0) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          distance = Math.hypot(dx, dy);
        }
        const desiredDistance = first.radius + second.radius + 28;
        const push = Math.max(0, desiredDistance - distance) * 0.055;
        const x = (dx / distance) * push;
        const y = (dy / distance) * push;
        forceX[i] -= x;
        forceY[i] -= y;
        forceX[j] += x;
        forceY[j] += y;
      }
    }

    for (let index = 0; index < layouts.length; index++) {
      const cluster = layouts[index];
      forceX[index] += (centerX - cluster.x) * 0.0007;
      forceY[index] += (centerY - cluster.y) * 0.0007;
      const magnitude = Math.hypot(forceX[index], forceY[index]);
      const step = Math.min(magnitude, 10 * cooling);
      if (magnitude > 0) {
        cluster.x += (forceX[index] / magnitude) * step;
        cluster.y += (forceY[index] / magnitude) * step;
      }
      cluster.x = Math.max(padding + cluster.radius, Math.min(width - padding - cluster.radius, cluster.x));
      cluster.y = Math.max(padding + cluster.radius, Math.min(height - padding - 74 - cluster.radius, cluster.y));
    }
  }

  const clusterByNode = new Array(nodes.length);
  layouts.forEach((cluster, clusterIndex) => {
    cluster.members.forEach(nodeIndex => {
      clusterByNode[nodeIndex] = clusterIndex;
      const node = nodes[nodeIndex];
      node.radius = 26 + Math.min(2, Math.sqrt(node.mutualCount) * 0.2);
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * cluster.radius * 0.68;
      node.x = cluster.x + Math.cos(angle) * distance;
      node.y = cluster.y + Math.sin(angle) * distance;
    });
  });

  for (let iteration = 0; iteration < 220; iteration++) {
    const forceX = new Array(nodes.length).fill(0);
    const forceY = new Array(nodes.length).fill(0);
    const cooling = 1 - iteration / 250;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const other = nodes[j];
        let dx = other.x - node.x;
        let dy = other.y - node.y;
        let distance = Math.hypot(dx, dy);
        if (distance === 0) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          distance = Math.hypot(dx, dy);
        }
        const push = 1800 / (distance * distance) +
          Math.max(0, node.radius + other.radius + 14 - distance) * 0.12;
        const x = (dx / distance) * push;
        const y = (dy / distance) * push;
        forceX[i] -= x;
        forceY[i] -= y;
        forceX[j] += x;
        forceY[j] += y;
      }
    }

    for (const [fromIndex, toIndex] of edges) {
      const from = nodes[fromIndex];
      const to = nodes[toIndex];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const targetLength = clusterByNode[fromIndex] === clusterByNode[toIndex] ? 72 : 112;
      const spring = (distance - targetLength) * 0.024;
      const x = (dx / distance) * spring;
      const y = (dy / distance) * spring;
      forceX[fromIndex] += x;
      forceY[fromIndex] += y;
      forceX[toIndex] -= x;
      forceY[toIndex] -= y;
    }

    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const cluster = layouts[clusterByNode[index]];
      const dx = node.x - cluster.x;
      const dy = node.y - cluster.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      forceX[index] -= dx * 0.008;
      forceY[index] -= dy * 0.008;
      const maximumDistance = cluster.radius - node.radius - 12;
      if (distance > maximumDistance) {
        const pull = (distance - maximumDistance) * 0.08;
        forceX[index] -= (dx / distance) * pull;
        forceY[index] -= (dy / distance) * pull;
      }
      const magnitude = Math.hypot(forceX[index], forceY[index]);
      const step = Math.min(magnitude, 8 * cooling);
      if (magnitude > 0) {
        node.x += (forceX[index] / magnitude) * step;
        node.y += (forceY[index] / magnitude) * step;
      }
      const movedX = node.x - cluster.x;
      const movedY = node.y - cluster.y;
      const movedDistance = Math.hypot(movedX, movedY);
      if (movedDistance > maximumDistance) {
        node.x = cluster.x + (movedX / movedDistance) * maximumDistance;
        node.y = cluster.y + (movedY / movedDistance) * maximumDistance;
      }
    }
  }

}

function separateOverlappingNodes(width, height, padding, pixelScale) {
  const { nodes } = graph;
  for (let iteration = 0; iteration < 3000; iteration++) {
    let largestOverlap = 0;
    for (let i = 0; i < nodes.length; i++) {
      const first = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const second = nodes[j];
        let dx = second.x - first.x;
        let dy = second.y - first.y;
        let distance = Math.hypot(dx, dy);
        if (distance === 0) {
          const angle = ((i + 1) * (j + 1) * 2.399963229728653) % (Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const requiredDistance = first.radius + second.radius + 12;
        const overlap = requiredDistance - distance;
        if (overlap <= 0) continue;
        largestOverlap = Math.max(largestOverlap, overlap);
        const correction = ((overlap + 0.1) * 0.52) / distance;
        const moveX = dx * correction;
        const moveY = dy * correction;
        first.x -= moveX;
        first.y -= moveY;
        second.x += moveX;
        second.y += moveY;
      }
    }
    if (largestOverlap <= 0.1) break;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }

  const shiftX = Math.max(0, padding - minX);
  const shiftY = Math.max(0, padding - minY);
  if (shiftX || shiftY) {
    for (const node of nodes) {
      node.x += shiftX;
      node.y += shiftY;
    }
    maxX += shiftX;
    maxY += shiftY;
  }

  width = Math.max(width, maxX + padding);
  height = Math.max(height, maxY + padding + 74);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * pixelScale);
  canvas.height = Math.round(height * pixelScale);
  context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);

  if (visualizationMode === 'clusters') {
    graph.clusterRegions = graph.clusters.map((members, index) => {
      const clusterNodes = members.map(nodeIndex => nodes[nodeIndex]);
      const x = clusterNodes.reduce((sum, node) => sum + node.x, 0) / clusterNodes.length;
      const y = clusterNodes.reduce((sum, node) => sum + node.y, 0) / clusterNodes.length;
      const radius = Math.max(...clusterNodes.map(node =>
        Math.hypot(node.x - x, node.y - y) + node.radius + 20
      ));
      return { index, x, y, radius };
    });
  }

  graph.layoutContainerWidth = canvas.parentElement.clientWidth;
  graph.layoutWidth = width;
  graph.layoutHeight = height;
}

function assignPositions() {
  if (!graph) return;
  const containerWidth = canvas.parentElement.clientWidth;
  const { nodes, clusters } = graph;
  if (!nodes.length) {
    drawGraph();
    return;
  }

  const graphExtent = Math.ceil(180 * Math.sqrt(nodes.length));
  const matrixCell = Math.max(14, Math.min(20, 1100 / Math.max(1, nodes.length)));
  const arcGap = Math.max(44, Math.min(52, 2400 / Math.max(1, nodes.length)));
  const baseWidth = Math.max(containerWidth, graphExtent, containerWidth < 720 ? containerWidth + 260 : 0);
  const baseHeight = Math.max(760, graphExtent);
  const width = visualizationMode === 'matrix'
    ? Math.max(containerWidth, 190 + nodes.length * matrixCell)
    : visualizationMode === 'arc'
      ? Math.max(containerWidth, 100 + Math.max(0, nodes.length - 1) * arcGap + 60)
      : baseWidth;
  const height = visualizationMode === 'matrix'
    ? Math.max(760, 240 + nodes.length * matrixCell)
    : visualizationMode === 'arc'
      ? 620
      : baseHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);

  const padding = 48;
  const usableWidth = Math.max(100, width - padding * 2);
  const usableHeight = Math.max(100, height - padding * 2 - 74);
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(usableWidth, usableHeight) * 0.42;
  const maxMutualCount = nodes.reduce((maximum, node) => Math.max(maximum, node.mutualCount), 1);
  let seed = Math.floor(graph.layoutSeed);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  if (visualizationMode === 'matrix') {
    graph.clusterRegions = [];
    const order = nodes.map((_, index) => index).sort((a, b) =>
      nodes[a].community - nodes[b].community ||
      nodes[a].username.localeCompare(nodes[b].username)
    );
    const matrixIndex = new Array(nodes.length);
    order.forEach((nodeIndex, index) => {
      matrixIndex[nodeIndex] = index;
      const node = nodes[nodeIndex];
      node.radius = matrixCell * 0.42;
      node.matrixIndex = index;
      node.x = 190 + index * matrixCell + matrixCell / 2;
      node.y = 190 + index * matrixCell + matrixCell / 2;
    });
    graph.matrixOrder = order;
    graph.matrixCell = matrixCell;
    graph.matrixIndex = matrixIndex;
    drawGraph();
    return;
  }

  if (visualizationMode === 'arc') {
    graph.clusterRegions = [];
    const order = nodes.map((_, index) => index).sort((a, b) =>
      nodes[a].community - nodes[b].community ||
      nodes[b].mutualCount - nodes[a].mutualCount ||
      nodes[a].username.localeCompare(nodes[b].username)
    );
    graph.arcOrder = order;
    graph.arcIndex = new Array(nodes.length);
    const gap = width > containerWidth ? (width - 100) / Math.max(1, nodes.length - 1) : arcGap;
    const startX = (width - Math.max(0, nodes.length - 1) * gap) / 2;
    const baseline = height * 0.68;
    order.forEach((nodeIndex, index) => {
      const node = nodes[nodeIndex];
      graph.arcIndex[nodeIndex] = index;
      node.radius = 14;
      node.x = startX + index * gap;
      node.y = baseline;
    });
    drawGraph();
    return;
  }

  if (visualizationMode === 'focus') {
    graph.clusterRegions = [];
    const focusIndex = Math.min(focusedNodeIndex, nodes.length - 1);
    const depths = new Array(nodes.length).fill(3);
    depths[focusIndex] = 0;
    const queue = [focusIndex];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      if (depths[index] >= 2) continue;
      for (const neighbor of nodes[index].links) {
        if (depths[neighbor] > depths[index] + 1) {
          depths[neighbor] = depths[index] + 1;
          queue.push(neighbor);
        }
      }
    }
    const centerX = width / 2;
    const centerY = height / 2;
    nodes.forEach((node, index) => {
      node.radius = index === focusIndex ? 34 : 26;
      node.focusDepth = depths[index];
    });
    const groups = [[], [], [], []];
    depths.forEach((depth, index) => groups[depth].push(index));
    for (const group of groups) {
      group.sort((a, b) => nodes[a].username.localeCompare(nodes[b].username));
    }
    const orbitRadii = [0, 0, 0, 0].map((_, depth) => {
      if (depth === 0) return 0;
      const circumferenceRadius = (groups[depth].length * (26 * 2 + 14)) / (2 * Math.PI);
      return Math.max(depth === 1 ? 145 : 235, circumferenceRadius) + (depth - 1) * 115;
    });
    groups.forEach((group, depth) => {
      group.forEach((nodeIndex, index) => {
        const node = nodes[nodeIndex];
        if (depth === 0) {
          node.x = centerX;
          node.y = centerY;
          return;
        }
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / group.length +
          (depth === 3 ? Math.PI / Math.max(1, group.length) : 0);
        node.x = centerX + Math.cos(angle) * orbitRadii[depth];
        node.y = centerY + Math.sin(angle) * orbitRadii[depth];
      });
    });
    separateOverlappingNodes(width, height, padding, scale);
    drawGraph();
    return;
  }

  if (visualizationMode === 'clusters') {
    assignClusterPositions(width, height, padding, usableWidth, usableHeight, random);
    separateOverlappingNodes(width, height, padding, scale);
    drawGraph();
    return;
  }

  graph.clusterRegions = [];
  for (const node of nodes) {
    node.radius = 26 + Math.min(2, Math.sqrt(node.mutualCount) * 0.2);
    node.x = padding + random() * usableWidth;
    node.y = padding + random() * usableHeight;
  }

  const edgeLength = Math.max(76, Math.min(110, Math.sqrt((usableWidth * usableHeight) / nodes.length) * 0.55));
  for (let iteration = 0; iteration < 220; iteration++) {
    const forceX = new Array(nodes.length).fill(0);
    const forceY = new Array(nodes.length).fill(0);
    const cooling = 1 - iteration / 250;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const other = nodes[j];
        let dx = other.x - node.x;
        let dy = other.y - node.y;
        let distance = Math.hypot(dx, dy);
        if (distance === 0) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          distance = Math.hypot(dx, dy);
        }
        const directionX = dx / distance;
        const directionY = dy / distance;
        const repulsion = 1800 / (distance * distance);
        const overlap = Math.max(0, node.radius + other.radius + 16 - distance) * 0.12;
        const push = repulsion + overlap;
        forceX[i] -= directionX * push;
        forceY[i] -= directionY * push;
        forceX[j] += directionX * push;
        forceY[j] += directionY * push;
      }
    }

    for (const [fromIndex, toIndex] of graph.edges) {
      const from = nodes[fromIndex];
      const to = nodes[toIndex];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const spring = (distance - edgeLength) * 0.028;
      const pullX = (dx / distance) * spring;
      const pullY = (dy / distance) * spring;
      forceX[fromIndex] += pullX;
      forceY[fromIndex] += pullY;
      forceX[toIndex] -= pullX;
      forceY[toIndex] -= pullY;
    }

    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const centerDx = node.x - centerX;
      const centerDy = node.y - centerY;
      const centerDistance = Math.max(1, Math.hypot(centerDx, centerDy));
      const centrality = Math.sqrt(node.mutualCount / maxMutualCount);
      const targetRadius = maxRadius * (1 - centrality);
      const radialForce = (targetRadius - centerDistance) * 0.012;
      forceX[index] += (centerDx / centerDistance) * radialForce;
      forceY[index] += (centerDy / centerDistance) * radialForce;
      const forceMagnitude = Math.hypot(forceX[index], forceY[index]);
      const step = Math.min(forceMagnitude, 8 * cooling);
      if (forceMagnitude > 0) {
        node.x += (forceX[index] / forceMagnitude) * step;
        node.y += (forceY[index] / forceMagnitude) * step;
      }
      node.x = Math.max(padding + node.radius, Math.min(width - padding - node.radius, node.x));
      node.y = Math.max(padding + node.radius, Math.min(height - padding - 74 - node.radius, node.y));
    }
  }
  separateOverlappingNodes(width, height, padding, scale);
  drawGraph();
}

function applyGraphTransform() {
  canvas.style.transform = `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`;
  document.querySelector('#zoom-level').textContent = `${Math.round(viewTransform.scale * 100)}%`;
}

function zoomGraph(scale, anchorX, anchorY) {
  const nextScale = Math.max(0.08, Math.min(4, scale));
  const ratio = nextScale / viewTransform.scale;
  viewTransform.x = anchorX - (anchorX - viewTransform.x) * ratio;
  viewTransform.y = anchorY - (anchorY - viewTransform.y) * ratio;
  viewTransform.scale = nextScale;
  applyGraphTransform();
}

function fitGraph() {
  if (!graph || !canvas.clientWidth || !canvas.clientHeight) return;
  const wrapper = canvas.parentElement;
  const padding = 60;
  viewTransform.scale = Math.max(0.08, Math.min(
    1,
    (wrapper.clientWidth - padding * 2) / canvas.clientWidth,
    (wrapper.clientHeight - padding * 2) / canvas.clientHeight
  ));
  viewTransform.x = (wrapper.clientWidth - canvas.clientWidth * viewTransform.scale) / 2;
  viewTransform.y = (wrapper.clientHeight - canvas.clientHeight * viewTransform.scale) / 2;
  applyGraphTransform();
}

function layoutGraphIfNeeded() {
  if (!graph || graphView.hidden) return;
  const width = canvas.parentElement.clientWidth;
  const extent = Math.ceil(180 * Math.sqrt(graph.nodes.length));
  if (!graphLayoutReady || graph.layoutContainerWidth !== width) {
    assignPositions();
    fitGraph();
    graphLayoutReady = true;
  }
}

function switchView(view) {
  const showGraph = view === 'graph';
  graphView.hidden = !showGraph;
  editorView.hidden = showGraph;
  viewTabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.view === view)));
  if (showGraph && graph) requestAnimationFrame(layoutGraphIfNeeded);
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
}

function drawGraph(hoveredIndex = -1) {
  if (!graph) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);

  if (visualizationMode === 'matrix') {
    const cell = graph.matrixCell;
    const left = 190;
    const top = 190;
    const matrixPosition = graph.matrixIndex;
    const order = graph.matrixOrder;
    context.fillStyle = '#e8eae4';
    context.font = '10px Inter, ui-sans-serif, system-ui, sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (let index = 0; index < order.length; index++) {
      const nodeIndex = order[index];
      const node = graph.nodes[nodeIndex];
      const active = hoveredIndex === nodeIndex;
      context.fillStyle = active ? '#ffffff' : '#b8beb6';
      context.fillText(node.username, left - 10, top + index * cell + cell / 2);
      context.save();
      context.translate(left + index * cell + cell / 2, top - 10);
      context.rotate(-Math.PI / 2);
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillText(node.username, 0, 0);
      context.restore();
      context.fillStyle = active ? '#ffffff' : '#667067';
      context.fillRect(left + index * cell + 1, top + index * cell + 1, cell - 2, cell - 2);
    }
    for (const [fromIndex, toIndex] of graph.edges) {
      const from = graph.nodes[fromIndex];
      const to = graph.nodes[toIndex];
      const fromPosition = matrixPosition[fromIndex];
      const toPosition = matrixPosition[toIndex];
      const highlighted = hoveredIndex === fromIndex || hoveredIndex === toIndex;
      context.fillStyle = highlighted
        ? palette[from.community % palette.length]
        : from.community === to.community
          ? `${palette[from.community % palette.length]}b0`
          : '#a4ada577';
      context.fillRect(left + toPosition * cell + 1, top + fromPosition * cell + 1, cell - 2, cell - 2);
      context.fillRect(left + fromPosition * cell + 1, top + toPosition * cell + 1, cell - 2, cell - 2);
    }
    return;
  }

  if (visualizationMode === 'clusters') {
    for (const region of graph.clusterRegions || []) {
      const color = palette[region.index % palette.length];
      context.beginPath();
      context.arc(region.x, region.y, region.radius, 0, Math.PI * 2);
      context.fillStyle = `${color}12`;
      context.fill();
      context.strokeStyle = `${color}55`;
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = `${color}cc`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif';
      context.fillText(
        `Cluster ${region.index + 1} · ${graph.clusters[region.index].length}`,
        region.x,
        region.y - region.radius + 15
      );
    }
  }

  if (visualizationMode === 'arc') {
    const baseline = graph.nodes[graph.arcOrder[0]]?.y ?? height * 0.68;
    context.beginPath();
    context.moveTo(35, baseline);
    context.lineTo(width - 35, baseline);
    context.strokeStyle = '#929b9144';
    context.lineWidth = 1;
    context.stroke();
  }

  for (const [fromIndex, toIndex] of graph.edges) {
    const from = graph.nodes[fromIndex];
    const to = graph.nodes[toIndex];
    const sameCommunity = from.community === to.community;
    const isHoveredEdge = fromIndex === hoveredIndex || toIndex === hoveredIndex;
    context.beginPath();
    if (visualizationMode === 'arc') {
      const distance = Math.abs(to.x - from.x);
      const arcHeight = Math.min(300, Math.max(34, distance * 0.34));
      context.moveTo(from.x, from.y);
      context.quadraticCurveTo((from.x + to.x) / 2, from.y - arcHeight, to.x, to.y);
    } else {
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
    }
    const focusOpacity = visualizationMode === 'focus'
      ? Math.min(from.focusDepth, to.focusDepth) > 1 ? '20' : 'b0'
      : null;
    context.strokeStyle = isHoveredEdge
      ? `${palette[from.community % palette.length]}e0`
      : focusOpacity
        ? `${sameCommunity ? palette[from.community % palette.length] : '#a4ada5'}${focusOpacity}`
        : sameCommunity
        ? `${palette[from.community % palette.length]}99`
        : '#a4ada555';
    context.lineWidth = isHoveredEdge ? 2.4 : sameCommunity ? 1.35 : 0.9;
    context.stroke();
  }

  graph.nodes.forEach((node, index) => {
    const color = palette[node.community % palette.length];
    const focusAlpha = visualizationMode === 'focus' && node.focusDepth > 1 ? '44' : 'ff';
    context.globalAlpha = visualizationMode === 'focus' && node.focusDepth > 1 ? 0.48 : 1;
    context.beginPath();
    if (visualizationMode === 'arc') {
      context.arc(node.x, node.y, node.radius + (index === hoveredIndex ? 2 : 0), 0, Math.PI * 2);
    } else {
      context.arc(node.x, node.y, node.radius + (index === hoveredIndex ? 2 : 0), 0, Math.PI * 2);
    }
    context.fillStyle = '#171c18';
    context.fill();
    context.strokeStyle = `${color}${focusAlpha}`;
    context.lineWidth = index === hoveredIndex ? 3 : 2;
    context.stroke();
    if (visualizationMode === 'arc') {
      context.save();
      context.translate(node.x - 2, node.y + node.radius + 8);
      context.rotate(-Math.PI / 4);
      context.fillStyle = '#d3d7d0';
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      context.font = '10px Inter, ui-sans-serif, system-ui, sans-serif';
      context.fillText(node.username, 0, 0);
      context.restore();
      if (index === hoveredIndex) {
        context.beginPath();
        context.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
        context.strokeStyle = `${color}99`;
        context.lineWidth = 1;
        context.stroke();
      }
      return;
    }
    context.fillStyle = '#f1f2ec';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 9px Inter, ui-sans-serif, system-ui, sans-serif';
    const lines = node.labelLines.length > 1
      ? [node.labelLines[0], node.labelLines[node.labelLines.length - 1]]
      : [node.labelLines[0] || node.username];
    const lineHeight = 11;
    lines.forEach((line, lineIndex) => {
      const yOffset = (lineIndex - (lines.length - 1) / 2) * lineHeight;
      context.fillText(line, node.x, node.y + yOffset, node.radius * 1.7);
    });
    if (index === hoveredIndex) {
      context.beginPath();
      context.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
      context.strokeStyle = `${color}99`;
      context.lineWidth = 1;
      context.stroke();
    }
    if (visualizationMode === 'focus' && index === focusedNodeIndex) {
      context.globalAlpha = 1;
      context.beginPath();
      context.arc(node.x, node.y, node.radius + 10, 0, Math.PI * 2);
      context.strokeStyle = '#f0e7a4';
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = '#f0e7a4';
      context.font = '600 9px Inter, ui-sans-serif, system-ui, sans-serif';
      context.fillText('FOCUS', node.x, node.y - node.radius - 18);
    }
    context.globalAlpha = 1;
  });
}

function showTooltip(node, x, y) {
  tooltip.innerHTML = '';
  const name = document.createElement('strong');
  name.textContent = node.name;
  const detail = document.createElement('span');
  detail.textContent = `@${node.username} · ${node.mutualCount} mutual${node.mutualCount === 1 ? '' : 's'}`;
  tooltip.append(name, detail);
  tooltip.hidden = false;
  const wrapRect = canvas.parentElement.getBoundingClientRect();
  tooltip.style.left = `${Math.min(x + 14, wrapRect.width - 245)}px`;
  tooltip.style.top = `${Math.max(12, y - 12)}px`;
}

function render(data) {
  graph = buildGraph(data);
  results.hidden = false;
  dropZone.hidden = true;
  downloadGraphButton.disabled = graph.nodes.length === 0;
  document.querySelector('#people-count').textContent = graph.nodes.length;
  document.querySelector('#connection-count').textContent = graph.edges.length;
  document.querySelector('#cluster-count').textContent = graph.clusters.length;
  const focusIndex = graph.nodes.map((node, index) => ({ node, index }))
    .sort((a, b) => b.node.mutualCount - a.node.mutualCount ||
      a.node.username.localeCompare(b.node.username))[0]?.index ?? 0;
  focusedNodeIndex = focusIndex;
  focusPersonSelect.replaceChildren(...graph.nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => a.node.username.localeCompare(b.node.username))
    .map(({ node, index }) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `@${node.username}`;
      option.selected = index === focusedNodeIndex;
      return option;
    }));
  focusControl.hidden = visualizationMode !== 'focus';
  if (resizeObserver) resizeObserver.disconnect();
  graphLayoutReady = false;
  resizeObserver = new ResizeObserver(layoutGraphIfNeeded);
  resizeObserver.observe(canvas.parentElement);
  layoutGraphIfNeeded();
  setStatus('');
}

function drawExportLegend(exportContext, width, startY, scale) {
  const padding = 16 * scale;
  const gap = 8 * scale;
  const itemHeight = 24 * scale;
  exportContext.font = `${11 * scale}px Inter, ui-sans-serif, system-ui, sans-serif`;

  const items = graph.clusters.map((members, index) => {
    const text = `Cluster ${index + 1} · ${members.length}`;
    return {
      text,
      color: palette[index % palette.length],
      width: exportContext.measureText(text).width + 30 * scale
    };
  });
  const rows = [];
  let row = [];
  let rowWidth = padding;
  for (const item of items) {
    if (row.length && rowWidth + item.width > width - padding) {
      rows.push(row);
      row = [];
      rowWidth = padding;
    }
    row.push(item);
    rowWidth += item.width + gap;
  }
  if (row.length) rows.push(row);

  rows.forEach((itemsInRow, rowIndex) => {
    let x = padding;
    const y = startY + rowIndex * itemHeight * scale;
    for (const item of itemsInRow) {
      exportContext.beginPath();
      exportContext.arc(x + 5 * scale, y + 10 * scale, 4 * scale, 0, Math.PI * 2);
      exportContext.fillStyle = item.color;
      exportContext.fill();
      exportContext.fillStyle = '#c7cdc4';
      exportContext.fillText(item.text, x + 14 * scale, y + 14 * scale);
      x += item.width + gap;
    }
  });
  return rows.length;
}

async function downloadGraphImage() {
  if (!graph || graph.nodes.length === 0) return;
  downloadGraphButton.disabled = true;
  setStatus('Preparing the full graph image…');

  try {
    const scale = window.devicePixelRatio || 1;
    const width = canvas.width;
    const legendMeasure = document.createElement('canvas').getContext('2d');
    legendMeasure.font = `${11 * scale}px Inter, ui-sans-serif, system-ui, sans-serif`;
    const rowCount = (() => {
      let rows = graph.clusters.length === 0 ? 0 : 1;
      let rowWidth = 16 * scale;
      for (let index = 0; index < graph.clusters.length; index++) {
        const text = `Cluster ${index + 1} · ${graph.clusters[index].length}`;
        const itemWidth = legendMeasure.measureText(text).width + 30 * scale;
        if (rowWidth > 16 * scale && rowWidth + itemWidth > width - 16 * scale) {
          rows++;
          rowWidth = 16 * scale;
        }
        rowWidth += itemWidth + 8 * scale;
      }
      return rows;
    })();
    const footerHeight = Math.ceil((rowCount * 24 + 24) * scale);
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = canvas.height + footerHeight;
    const exportContext = exportCanvas.getContext('2d');
    if (!exportContext) throw new Error('Could not create an image canvas.');

    exportContext.fillStyle = '#141815';
    exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportContext.drawImage(canvas, 0, 0);
    drawExportLegend(exportContext, width, canvas.height + 12 * scale, scale);

    const blob = await new Promise((resolve, reject) => {
      exportCanvas.toBlob(image => {
        if (image) resolve(image);
        else reject(new Error('The browser could not encode the graph image.'));
      }, 'image/png');
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'friends-graph.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Downloaded friends-graph.png with the full graph and cluster legend.');
  } catch (error) {
    setStatus(`Could not download the graph image: ${error.message}`, true);
  } finally {
    downloadGraphButton.disabled = graph.nodes.length === 0;
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
    setStatus('Please choose a JSON file.', true);
    return;
  }

  try {
    const data = JSON.parse(await file.text());
    document.dispatchEvent(new CustomEvent('friends-list-imported', { detail: data }));
  } catch (error) {
    setStatus(error instanceof SyntaxError ? 'Could not read that file as valid JSON.' : error.message, true);
  }
}

downloadGraphButton.addEventListener('click', downloadGraphImage);
fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
document.querySelector('#zoom-in').addEventListener('click', () => {
  const wrapper = canvas.parentElement;
  zoomGraph(viewTransform.scale * 1.25, wrapper.clientWidth / 2, wrapper.clientHeight / 2);
});
document.querySelector('#zoom-out').addEventListener('click', () => {
  const wrapper = canvas.parentElement;
  zoomGraph(viewTransform.scale / 1.25, wrapper.clientWidth / 2, wrapper.clientHeight / 2);
});
document.querySelector('#fit-graph').addEventListener('click', fitGraph);
visualizationSelect.addEventListener('change', () => {
  visualizationMode = visualizationSelect.value;
  focusControl.hidden = visualizationMode !== 'focus';
  graphLayoutReady = false;
  layoutGraphIfNeeded();
});
focusPersonSelect.addEventListener('change', () => {
  focusedNodeIndex = Number(focusPersonSelect.value);
  graphLayoutReady = false;
  layoutGraphIfNeeded();
});
viewTabs.forEach(tab => tab.addEventListener('click', () => switchView(tab.dataset.view)));
document.querySelector('#show-graph').addEventListener('click', () => switchView('graph'));
document.addEventListener('friends-list-updated', event => render(event.detail));
document.addEventListener('friends-list-import-error', event => {
  setStatus(event.detail, true);
});

for (const eventName of ['dragenter', 'dragover']) {
  graphView.addEventListener(eventName, event => {
    event.preventDefault();
    graphWrap.classList.add('is-dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  graphView.addEventListener(eventName, event => {
    event.preventDefault();
    graphWrap.classList.remove('is-dragging');
  });
}
graphView.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

let isPanning = false;
let lastPointer = null;
let pointerStart = null;
canvas.addEventListener('pointerdown', event => {
  isPanning = true;
  lastPointer = { x: event.clientX, y: event.clientY };
  pointerStart = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointerup', event => {
  const wasClick = pointerStart &&
    Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 4;
  if (wasClick && visualizationMode === 'focus' && graph) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / viewTransform.scale;
    const y = (event.clientY - rect.top) / viewTransform.scale;
    const nearest = graph.nodes
      .map((node, index) => ({ node, index, distance: Math.hypot(node.x - x, node.y - y) }))
      .filter(item => item.distance <= item.node.radius + 7)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest) {
      focusedNodeIndex = nearest.index;
      focusPersonSelect.value = String(focusedNodeIndex);
      graphLayoutReady = false;
      layoutGraphIfNeeded();
    }
  }
  isPanning = false;
  lastPointer = null;
  pointerStart = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  canvas.style.cursor = 'grab';
});

canvas.addEventListener('pointermove', event => {
  if (isPanning && lastPointer) {
    viewTransform.x += event.clientX - lastPointer.x;
    viewTransform.y += event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    applyGraphTransform();
    tooltip.hidden = true;
    return;
  }
  if (!graph) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / viewTransform.scale;
  const y = (event.clientY - rect.top) / viewTransform.scale;
  let nearestIndex = -1;
  let nearestDistance = Infinity;
  graph.nodes.forEach((node, index) => {
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance <= node.radius + 7 && distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  });

  if (nearestIndex < 0) {
    tooltip.hidden = true;
    canvas.style.cursor = 'grab';
    drawGraph();
    return;
  }
  canvas.style.cursor = 'pointer';
  drawGraph(nearestIndex);
  const wrapperRect = canvas.parentElement.getBoundingClientRect();
  showTooltip(graph.nodes[nearestIndex], event.clientX - wrapperRect.left, event.clientY - wrapperRect.top);
});

canvas.addEventListener('pointerleave', () => {
  if (isPanning) return;
  tooltip.hidden = true;
  canvas.style.cursor = 'grab';
  drawGraph();
});

canvas.addEventListener('pointercancel', () => {
  isPanning = false;
  lastPointer = null;
});
canvas.parentElement.addEventListener('wheel', event => {
  event.preventDefault();
  const rect = canvas.parentElement.getBoundingClientRect();
  const anchorX = event.clientX - rect.left;
  const anchorY = event.clientY - rect.top;
  zoomGraph(viewTransform.scale * Math.exp(-event.deltaY * 0.001), anchorX, anchorY);
}, { passive: false });

document.addEventListener('friends-list-updated', event => {
  try {
    localStorage.setItem('friends-list-builder-v1', JSON.stringify(event.detail));
  } catch (error) {
    setStatus(`Could not save your edited list: ${error.message}`, true);
  }
});

try {
  const savedList = localStorage.getItem('friends-list-builder-v1');
  if (savedList) {
    const saved = JSON.parse(savedList);
    render(saved);
  }
} catch (error) {
  setStatus(`Could not restore your saved list: ${error.message}`, true);
}

if (location.hash === '#edit' || location.hash === '#editor') switchView('editor');
