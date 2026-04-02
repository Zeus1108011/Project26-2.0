import {
  ACTIVITY_GROUPS,
  ASSET_GROUPS,
  LEGACY_STORAGE_KEYS,
  RESOURCE_ITEMS,
  REWARD_ITEMS,
  STORAGE_KEY,
} from "./project-data.js";

const statsEl = document.querySelector("#stats");
const balanceEl = document.querySelector("#balance");
const activityGroupsEl = document.querySelector("#activity-groups");
const rewardGridEl = document.querySelector("#reward-grid");
const assetGroupsEl = document.querySelector("#asset-groups");
const inventoryTableBodyEl = document.querySelector("#inventory-table-body");
const sellGridEl = document.querySelector("#sell-grid");
const clockDateEl = document.querySelector("#clock-date");
const clearHistoryButton = document.querySelector("#clear-history-button");
const historyListEl = document.querySelector("#history-list");
const resetSaveButton = document.querySelector("#reset-save-button");

const ACTIVITY_LOOKUP = new Map(
  ACTIVITY_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item])),
);
const REWARD_LOOKUP = new Map(REWARD_ITEMS.map((item) => [item.id, item]));
const RESOURCE_LOOKUP = new Map(RESOURCE_ITEMS.map((item) => [item.id, item]));
const ASSET_LOOKUP = new Map(
  ASSET_GROUPS.flatMap((group) => group.items.map((item) => [item.id, item])),
);

let state = loadState();
advanceCalendarIfNeeded();

buildActivityGroups();
buildRewards();
buildAssets();
buildInventoryTable();
buildSellGrid();
attachActions();
render();

function loadState() {
  clearLegacyStorage();

  const baseInventory = createBaseInventory();

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) {
      return createDefaultState(baseInventory);
    }

    return {
      balance: Number(saved.balance) || 0,
      lifetimeEarned: Number(saved.lifetimeEarned) || 0,
      lifetimeSpent: Number(saved.lifetimeSpent) || 0,
      history: Array.isArray(saved.history) ? saved.history : [],
      ownedAssets: saved.ownedAssets && typeof saved.ownedAssets === "object" ? saved.ownedAssets : {},
      inventory: {
        ...baseInventory,
        ...(saved.inventory && typeof saved.inventory === "object" ? saved.inventory : {}),
      },
      lastProcessedMonth:
        typeof saved.lastProcessedMonth === "number"
          ? saved.lastProcessedMonth
          : getMonthIndex(new Date()),
      startDayIndex:
        typeof saved.startDayIndex === "number"
          ? saved.startDayIndex
          : getDayIndex(new Date()),
      lastAutomationRunAt: Number(saved.lastAutomationRunAt) || Date.now(),
    };
  } catch (error) {
    return createDefaultState(baseInventory);
  }
}

function clearLegacyStorage() {
  LEGACY_STORAGE_KEYS.forEach((key) => {
    localStorage.removeItem(key);
  });
}

function createDefaultState(baseInventory) {
  return {
    balance: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    history: [],
    ownedAssets: {},
    inventory: baseInventory,
    lastProcessedMonth: getMonthIndex(new Date()),
    startDayIndex: getDayIndex(new Date()),
    lastAutomationRunAt: Date.now(),
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function advanceCalendarIfNeeded() {
  const now = new Date();
  const currentMonthIndex = getMonthIndex(now);

  while (state.lastProcessedMonth < currentMonthIndex) {
    const nextMonth = monthIndexToDate(state.lastProcessedMonth + 1);
    processMonth(nextMonth);
    state.lastProcessedMonth += 1;
    state.lastAutomationRunAt = nextMonth.getTime();
  }

  saveState();
}

function processMonth(date) {
  const monthLabel = formatMonth(date);
  const summary = {
    outputs: {},
    inputs: {},
  };

  for (const group of ASSET_GROUPS) {
    for (const asset of group.items) {
      const ownership = getOwnership(asset.id);
      const count = getOwnedCount(asset, ownership);
      if (count === 0) {
        continue;
      }

      const levelConfig = getLevelConfig(asset, ownership.level);
      const runs = getRunnableCount(count, levelConfig.inputs || {});
      if (runs === 0) {
        continue;
      }

      applyResourceDelta(levelConfig.inputs, -runs, summary.inputs);
      applyResourceDelta(levelConfig.outputs, runs, summary.outputs);
    }
  }

  const outputSummary = summarizeDelta(summary.outputs);
  const inputSummary = summarizeDelta(summary.inputs);

  addHistory({
    type: "automation",
    title: `Monthly automation for ${monthLabel}`,
    amount: 0,
    detail: outputSummary || inputSummary
      ? `${outputSummary || "No output"}${inputSummary ? ` | Used ${inputSummary}` : ""}`
      : "No automated production this month",
  });
}

function getRunnableCount(count, inputs) {
  let runs = count;
  const inputEntries = Object.entries(inputs);

  if (inputEntries.length === 0) {
    return runs;
  }

  inputEntries.forEach(([resourceId, amountNeeded]) => {
    const onHand = Number(state.inventory[resourceId] || 0);
    runs = Math.min(runs, Math.floor(onHand / amountNeeded));
  });

  return Math.max(0, runs);
}

function applyResourceDelta(resources = {}, multiplier, summaryBucket) {
  Object.entries(resources).forEach(([resourceId, amount]) => {
    const delta = roundQuantity(amount * multiplier);
    state.inventory[resourceId] = roundQuantity((state.inventory[resourceId] || 0) + delta);
    summaryBucket[resourceId] = roundQuantity((summaryBucket[resourceId] || 0) + Math.abs(delta));
  });
}

function buildActivityGroups() {
  const fragment = document.createDocumentFragment();

  ACTIVITY_GROUPS.forEach((group) => {
    const section = document.createElement("section");
    section.className = "group-section";

    section.innerHTML = `<div class="group-header"><h3>${group.title}</h3></div>`;
    const grid = document.createElement("div");
    grid.className = "card-grid";

    group.items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <div class="card-copy">
          <p class="card-title">${item.name}</p>
          <p class="card-meta">$${formatNumber(item.rate)} per ${item.unit}</p>
        </div>
        <div class="card-controls">
          <label class="sr-only" for="activity-${item.id}">${item.name} amount</label>
          <input id="activity-${item.id}" class="quantity-input" data-activity-input="${item.id}" type="number" min="${item.step < 1 ? item.step : 1}" step="${item.step}" value="${item.step < 1 ? item.step : 1}" />
          <button data-log-activity="${item.id}" type="button">Log</button>
        </div>
      `;
      grid.appendChild(card);
    });

    section.appendChild(grid);
    fragment.appendChild(section);
  });

  activityGroupsEl.appendChild(fragment);
}

function buildRewards() {
  const fragment = document.createDocumentFragment();

  REWARD_ITEMS.forEach((item) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-copy">
        <p class="card-title">${item.name}</p>
        <p class="card-meta">$${formatNumber(item.cost)} per ${item.unit}</p>
      </div>
      <div class="card-controls">
        <label class="sr-only" for="reward-${item.id}">${item.name} quantity</label>
        <input id="reward-${item.id}" class="quantity-input" data-reward-quantity="${item.id}" type="number" min="1" step="1" value="1" />
        <button data-buy-reward="${item.id}" type="button">Buy</button>
      </div>
    `;
    fragment.appendChild(card);
  });

  rewardGridEl.appendChild(fragment);
}

function buildAssets() {
  const fragment = document.createDocumentFragment();

  ASSET_GROUPS.forEach((group) => {
    const section = document.createElement("section");
    section.className = "group-section";
    section.innerHTML = `<div class="group-header"><h3>${group.title}</h3></div>`;

    const grid = document.createElement("div");
    grid.className = "asset-grid";

    group.items.forEach((asset) => {
      const card = document.createElement("article");
      card.className = "asset-card";
      card.innerHTML = `
        <div class="asset-head">
          <div>
            <p class="asset-category">${asset.category}</p>
            <h3>${asset.name}</h3>
          </div>
          <p class="asset-price">${formatCurrency(asset.levels[0].cost)}</p>
        </div>
        <p class="asset-income" data-asset-flow="${asset.id}"></p>
        <ul class="asset-details">${asset.details.map((detail) => `<li>${detail}</li>`).join("")}</ul>
        <div class="asset-status" data-asset-status="${asset.id}"></div>
        <div class="asset-actions">
          <button data-buy-asset="${asset.id}" type="button">Buy</button>
        </div>
      `;
      grid.appendChild(card);
    });

    section.appendChild(grid);
    fragment.appendChild(section);
  });

  assetGroupsEl.appendChild(fragment);
}

function buildInventoryTable() {
  const resourceRows = RESOURCE_ITEMS.map((resource) => {
    const priceLabel = resource.price === null ? (resource.priceNote || "Not sellable") : formatCurrency(resource.price);
    return `
      <tr>
        <td>
          <div class="table-item">
            <span>${resource.name}</span>
            ${resource.priceNote ? `<span class="table-note">${resource.priceNote}</span>` : ""}
          </div>
        </td>
        <td data-resource-quantity="${resource.id}">0</td>
        <td data-resource-production="${resource.id}">0</td>
        <td data-resource-usage="${resource.id}">0</td>
        <td data-resource-net="${resource.id}">0</td>
        <td data-resource-price="${resource.id}">${priceLabel}</td>
      </tr>
    `;
  }).join("");

  inventoryTableBodyEl.innerHTML = `
    ${resourceRows}
    <tr class="money-row">
      <td>Total Money</td>
      <td id="money-quantity">0</td>
      <td id="money-production">0</td>
      <td id="money-usage">0</td>
      <td id="money-net">0</td>
      <td>-</td>
    </tr>
  `;
}

function buildSellGrid() {
  sellGridEl.innerHTML = RESOURCE_ITEMS.map((resource) => `
    <article class="card">
      <div class="card-copy">
        <p class="card-title">${resource.name}</p>
        <p class="card-meta">${resource.price === null ? (resource.priceNote || "Not sellable") : `${formatCurrency(resource.price)} per ${resource.unit}`}</p>
      </div>
      <div class="card-controls">
        <label class="sr-only" for="sell-${resource.id}">${resource.name} quantity</label>
        <input id="sell-${resource.id}" class="quantity-input sell-input" data-sell-input="${resource.id}" type="number" min="1" step="1" value="1" />
        <button data-sell-resource="${resource.id}" type="button">Sell</button>
      </div>
    </article>
  `).join("");
}

function attachActions() {
  document.addEventListener("click", (event) => {
    const activityId = event.target.closest("[data-log-activity]")?.dataset.logActivity;
    if (activityId) {
      logActivity(activityId);
      return;
    }

    const rewardId = event.target.closest("[data-buy-reward]")?.dataset.buyReward;
    if (rewardId) {
      buyReward(rewardId);
      return;
    }

    const assetId = event.target.closest("[data-buy-asset]")?.dataset.buyAsset;
    if (assetId) {
      buyAsset(assetId);
      return;
    }
    const resourceId = event.target.closest("[data-sell-resource]")?.dataset.sellResource;
    if (resourceId) {
      sellResource(resourceId);
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-reward-quantity], [data-sell-input]")) {
      render();
    }
  });

  clearHistoryButton.addEventListener("click", () => {
    state.history = [];
    persistAndRender();
  });

  resetSaveButton.addEventListener("click", () => {
    const confirmed = window.confirm("Reset your balance, history, purchases, and resources?");
    if (!confirmed) {
      return;
    }

    state = createDefaultState(createBaseInventory());
    persistAndRender();
  });
}

function createBaseInventory() {
  return Object.fromEntries(
    RESOURCE_ITEMS.filter((resource) => resource.saleMode !== "asset").map((resource) => [resource.id, 0]),
  );
}

function logActivity(activityId) {
  const activity = ACTIVITY_LOOKUP.get(activityId);
  const input = document.querySelector(`[data-activity-input="${activityId}"]`);
  const amount = Number(input.value);

  if (!activity || !Number.isFinite(amount) || amount <= 0) {
    return;
  }

  const earned = roundCurrency(activity.rate * amount);
  state.balance = roundCurrency(state.balance + earned);
  state.lifetimeEarned = roundCurrency(state.lifetimeEarned + earned);

  addHistory({
    type: "earn",
    title: activity.name,
    amount: earned,
    detail: `${formatNumber(amount)} ${pluralize(activity.unit, amount)}`,
  });

  input.value = activity.step < 1 ? String(activity.step) : "1";
  persistAndRender();
}

function buyReward(rewardId) {
  const reward = REWARD_LOOKUP.get(rewardId);
  const input = document.querySelector(`[data-reward-quantity="${rewardId}"]`);
  const quantity = Math.max(1, Math.floor(Number(input.value) || 1));
  const totalCost = roundCurrency(reward.cost * quantity);

  if (!reward || state.balance < totalCost) {
    return;
  }

  state.balance = roundCurrency(state.balance - totalCost);
  state.lifetimeSpent = roundCurrency(state.lifetimeSpent + totalCost);

  addHistory({
    type: "spend",
    title: reward.name,
    amount: totalCost,
    detail: `${quantity} ${pluralize(reward.unit, quantity)}`,
  });

  input.value = "1";
  persistAndRender();
}

function buyAsset(assetId) {
  const asset = ASSET_LOOKUP.get(assetId);
  if (!asset) {
    return;
  }

  const ownership = getOwnership(assetId);
  const cost = asset.levels[0].cost;

  if (state.balance < cost || !hasRequiredBuildMaterials(asset)) {
    return;
  }

  if (asset.unique && ownership.level > 0) {
    return;
  }

  if (asset.requiresCapacityFrom && !hasCapacityForPurchase(asset)) {
    return;
  }

  state.balance = roundCurrency(state.balance - cost);
  state.lifetimeSpent = roundCurrency(state.lifetimeSpent + cost);
  spendBuildMaterials(asset);

  state.ownedAssets[assetId] = {
    level: 1,
    count: asset.repeatable ? getOwnedCount(asset, ownership) + 1 : 1,
  };

  addHistory({
    type: "asset-buy",
    title: asset.name,
    amount: cost,
    detail: asset.repeatable
      ? `Owned ${getOwnedCount(asset, state.ownedAssets[assetId])} ${pluralize("unit", getOwnedCount(asset, state.ownedAssets[assetId]))}`
      : "Bought level 1",
  });

  persistAndRender();
}

function sellResource(resourceId) {
  const resource = RESOURCE_LOOKUP.get(resourceId);
  const input = document.querySelector(`[data-sell-input="${resourceId}"]`);
  const quantity = Math.max(1, Math.floor(Number(input.value) || 1));

  if (!resource || resource.price === null) {
    return;
  }

  const available = getResourceQuantity(resourceId);
  if (available < quantity) {
    return;
  }

  if (resource.saleMode === "asset") {
    decrementAssetBackedResource(resource, quantity);
  } else {
    state.inventory[resourceId] = roundQuantity((state.inventory[resourceId] || 0) - quantity);
  }

  const earned = roundCurrency(resource.price * quantity);
  state.balance = roundCurrency(state.balance + earned);
  state.lifetimeEarned = roundCurrency(state.lifetimeEarned + earned);

  addHistory({
    type: "sell",
    title: `Sold ${resource.name}`,
    amount: earned,
    detail: `${quantity} ${pluralize(resource.unit, quantity)}`,
  });

  input.value = "1";
  persistAndRender();
}

function decrementAssetBackedResource(resource, quantity) {
  const asset = ASSET_LOOKUP.get(resource.assetId);
  const ownership = getOwnership(resource.assetId);
  const nextCount = Math.max(0, getOwnedCount(asset, ownership) - quantity);

  state.ownedAssets[resource.assetId] = {
    level: nextCount > 0 ? 1 : 0,
    count: nextCount,
  };
}

function render() {
  renderBalance();
  renderStats();
  renderRewards();
  renderAssets();
  renderInventory();
  renderClock();
  renderHistory();
}

function renderBalance() {
  balanceEl.textContent = formatCurrency(state.balance);
}

function renderStats() {
  const dayCount = getCurrentDayCount();
  const stats = [
    {
      label: "Earned",
      value: formatCurrency(state.lifetimeEarned),
    },
    {
      label: "Spent",
      value: formatCurrency(state.lifetimeSpent),
    },
    {
      label: "Day",
      value: `Day ${dayCount}`,
    },
  ];

  statsEl.innerHTML = stats.map((stat) => `
    <article class="stat-card">
      <p class="stat-title">${stat.label}</p>
      <p class="stat-value">${stat.value}</p>
    </article>
  `).join("");
}

function renderRewards() {
  REWARD_ITEMS.forEach((reward) => {
    const input = document.querySelector(`[data-reward-quantity="${reward.id}"]`);
    const button = document.querySelector(`[data-buy-reward="${reward.id}"]`);
    const quantity = Math.max(1, Math.floor(Number(input.value) || 1));
    const totalCost = reward.cost * quantity;
    button.disabled = state.balance < totalCost;
    button.textContent = state.balance < totalCost ? `Need ${formatCurrency(totalCost)}` : `Buy for ${formatCurrency(totalCost)}`;
  });
}

function renderAssets() {
  ASSET_GROUPS.forEach((group) => {
    group.items.forEach((asset) => {
      const ownership = getOwnership(asset.id);
      const flowEl = document.querySelector(`[data-asset-flow="${asset.id}"]`);
      const statusEl = document.querySelector(`[data-asset-status="${asset.id}"]`);
      const buyButton = document.querySelector(`[data-buy-asset="${asset.id}"]`);
      const count = getOwnedCount(asset, ownership);
      const levelConfig = getLevelConfig(asset, ownership.level || 1);
      const blocked = asset.requiresCapacityFrom && !hasCapacityForPurchase(asset);
      const canAffordMoney = state.balance >= asset.levels[0].cost;
      const hasMaterials = hasRequiredBuildMaterials(asset);
      const supportsFlow = canPurchaseWithoutNegativeFlow(asset);

      flowEl.textContent = getFlowLabel(asset, levelConfig);

      if (count > 0) {
        const capacityMessage = asset.repeatable ? `${count} owned.` : `Level ${ownership.level} owned.`;
        statusEl.innerHTML = `<p class="status-pill owned">${capacityMessage}</p>`;
      } else {
        statusEl.innerHTML = `
          <p class="status-pill ${blocked ? "blocked" : "available"}">${
            blocked ? `Needs ${asset.capacityLabel}` : "Available"
          }</p>
        `;
      }

      buyButton.disabled =
        !canAffordMoney ||
        !hasMaterials ||
        !supportsFlow ||
        (asset.unique && ownership.level > 0) ||
        blocked;
      buyButton.textContent =
        !canAffordMoney
          ? `Need ${formatCurrency(asset.levels[0].cost)}`
          : !hasMaterials
            ? "Need materials"
            : !supportsFlow
              ? "Need production"
            : asset.repeatable && count > 0
              ? "Buy another"
              : "Buy now";
    });
  });
}

function renderInventory() {
  const projection = getMonthlyProjection();

  RESOURCE_ITEMS.forEach((resource) => {
    const quantity = getResourceQuantity(resource.id);
    const production = projection.outputs[resource.id] || 0;
    const usage = projection.inputs[resource.id] || 0;
    const net = roundQuantity(production - usage);
    const sellInput = document.querySelector(`[data-sell-input="${resource.id}"]`);
    const sellButton = document.querySelector(`[data-sell-resource="${resource.id}"]`);

    document.querySelector(`[data-resource-quantity="${resource.id}"]`).textContent = formatNumber(quantity);
    document.querySelector(`[data-resource-production="${resource.id}"]`).textContent = formatNumber(production);
    document.querySelector(`[data-resource-usage="${resource.id}"]`).textContent = formatNumber(usage);
    document.querySelector(`[data-resource-net="${resource.id}"]`).textContent = formatSignedNumber(net);

    const sellQuantity = Math.max(1, Math.floor(Number(sellInput.value) || 1));
    sellButton.disabled = resource.price === null || quantity < sellQuantity;
    sellButton.textContent =
      resource.price === null ? "Not sellable" : `Sell ${formatCurrency(resource.price * sellQuantity)}`;
  });

  document.querySelector("#money-quantity").textContent = formatCurrency(state.balance);
  document.querySelector("#money-production").textContent = "-";
  document.querySelector("#money-usage").textContent = "-";
  document.querySelector("#money-net").textContent = "-";
}

function renderClock() {
  const now = new Date();
  clockDateEl.textContent = now.toLocaleDateString("en-CA", {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function renderHistory() {
  if (state.history.length === 0) {
    historyListEl.innerHTML = `
      <article class="history-item empty">
        <p>No history yet.</p>
        <p>Log activities, buy assets, or wait for the monthly clock to process.</p>
      </article>
    `;
    return;
  }

  historyListEl.innerHTML = state.history
    .slice()
    .reverse()
    .slice(0, 18)
    .map((entry) => {
      const isPositive = entry.type === "earn" || entry.type === "sell";
      const amountMarkup = entry.amount
        ? `<p class="history-amount ${isPositive ? "positive" : "negative"}">${isPositive ? "+" : "-"}${formatCurrency(entry.amount)}</p>`
        : `<p class="history-amount neutral">Auto</p>`;

      return `
        <article class="history-item">
          <div>
            <p class="history-title">${entry.title}</p>
          </div>
          <div class="history-side">
            ${amountMarkup}
            <p class="history-time">${formatTimestamp(entry.timestamp)}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function addHistory(entry) {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  state.history.push({
    id,
    timestamp: Date.now(),
    ...entry,
  });

  if (state.history.length > 150) {
    state.history = state.history.slice(-150);
  }
}

function getMonthlyProjection(candidateAssetId = null) {
  const outputs = {};
  const inputs = {};

  ASSET_GROUPS.forEach((group) => {
    group.items.forEach((asset) => {
      const ownership = getOwnership(asset.id);
      let count = getOwnedCount(asset, ownership);
      if (candidateAssetId && asset.id === candidateAssetId) {
        count += 1;
      }
      if (count === 0) {
        return;
      }

      const levelConfig = getLevelConfig(asset, ownership.level);
      addToBucket(outputs, levelConfig.outputs, count);
      addToBucket(inputs, levelConfig.inputs, count);
    });
  });

  return { outputs, inputs };
}

function addToBucket(bucket, values = {}, multiplier = 1) {
  Object.entries(values).forEach(([resourceId, amount]) => {
    bucket[resourceId] = roundQuantity((bucket[resourceId] || 0) + amount * multiplier);
  });
}

function getFlowLabel(asset, levelConfig) {
  const outputText = summarizeDelta(levelConfig.outputs);
  const inputText = summarizeDelta(levelConfig.inputs);

  if (outputText && inputText) {
    return `Makes ${outputText} using ${inputText} each month`;
  }

  if (outputText) {
    return `Makes ${outputText} each month`;
  }

  return "No automatic monthly resource output";
}

function summarizeDelta(values = {}) {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return "";
  }

  return entries
    .map(([resourceId, amount]) => `${formatNumber(amount)} ${RESOURCE_LOOKUP.get(resourceId)?.name || resourceId}`)
    .join(", ");
}

function summarizeNetFlow(flow) {
  const netEntries = RESOURCE_ITEMS.map((resource) => {
    const production = flow.outputs[resource.id] || 0;
    const usage = flow.inputs[resource.id] || 0;
    const net = roundQuantity(production - usage);
    return { resource, net };
  }).filter((entry) => entry.net !== 0);

  if (netEntries.length === 0) {
    return "No active monthly resource change yet";
  }

  return netEntries
    .slice(0, 3)
    .map((entry) => `${entry.net > 0 ? "+" : ""}${formatNumber(entry.net)} ${entry.resource.name}`)
    .join(" | ");
}

function hasRequiredBuildMaterials(asset) {
  return Object.entries(asset.buildCosts || {}).every(([resourceId, amount]) => {
    return (state.inventory[resourceId] || 0) >= amount;
  });
}

function spendBuildMaterials(asset) {
  Object.entries(asset.buildCosts || {}).forEach(([resourceId, amount]) => {
    state.inventory[resourceId] = roundQuantity((state.inventory[resourceId] || 0) - amount);
  });
}

function hasCapacityForPurchase(asset) {
  const housing = ASSET_LOOKUP.get(asset.requiresCapacityFrom);
  const housingCount = getOwnedCount(housing, getOwnership(asset.requiresCapacityFrom));
  const currentCount = getOwnedCount(asset, getOwnership(asset.id));
  const capacity = housingCount * (housing?.capacityProvided || 1);
  return capacity > currentCount;
}

function canPurchaseWithoutNegativeFlow(asset) {
  const levelConfig = getLevelConfig(asset, 1);
  const hasInputs = Object.keys(levelConfig.inputs || {}).length > 0;
  if (!hasInputs) {
    return true;
  }

  const candidateFlow = getMonthlyProjection(asset.id);
  return Object.keys(levelConfig.inputs).every((resourceId) => {
    const production = candidateFlow.outputs[resourceId] || 0;
    const usage = candidateFlow.inputs[resourceId] || 0;
    return production - usage >= 0;
  });
}

function getOwnership(assetId) {
  return state.ownedAssets[assetId] || { level: 0, count: 0 };
}

function getOwnedCount(asset, ownership) {
  if (!asset || ownership.level === 0) {
    return 0;
  }
  return asset.repeatable ? ownership.count || 0 : 1;
}

function getLevelConfig(asset, level) {
  return asset.levels.find((item) => item.level === level) || asset.levels[0];
}

function getResourceQuantity(resourceId) {
  const resource = RESOURCE_LOOKUP.get(resourceId);
  if (resource?.saleMode === "asset") {
    const asset = ASSET_LOOKUP.get(resource.assetId);
    return getOwnedCount(asset, getOwnership(resource.assetId));
  }

  return roundQuantity(state.inventory[resourceId] || 0);
}

function persistAndRender() {
  saveState();
  render();
}

function getMonthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function monthIndexToDate(monthIndex) {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  return new Date(year, month, 1);
}

function formatMonth(date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTimestamp(timestamp) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatCurrency(value) {
  return `$${new Intl.NumberFormat("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-CA", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 0,
    maximumFractionDigits: 3,
  }).format(value);
}

function formatSignedNumber(value) {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function pluralize(unit, count) {
  return Math.abs(count) === 1 ? unit : `${unit}s`;
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value) {
  return Math.round(value * 1000) / 1000;
}

function getDayIndex(date) {
  return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86400000);
}

function dayIndexToDate(dayIndex) {
  return new Date(dayIndex * 86400000);
}

function getCurrentDayCount() {
  return Math.max(1, getDayIndex(new Date()) - state.startDayIndex + 1);
}
