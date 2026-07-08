import type { ScoutBlueprintConfig, ScoutDerivedState, ScoutEntity } from "./types";

export type ScoutDemoShellRenderer = {
  renderResult?: (entity: ScoutEntity) => string;
};

export function renderScoutDemoShell(
  config: ScoutBlueprintConfig,
  derived: ScoutDerivedState,
  renderer: ScoutDemoShellRenderer = {},
): string {
  const activeActionId = derived.activeAction?.id ?? "";
  const renderResult = renderer.renderResult ?? renderDefaultResult;
  const actions = config.actions
    .map((action) => {
      const pressed = action.id === activeActionId ? "true" : "false";
      return `<button type="button" data-scout-action="${escapeHtml(action.id)}" aria-pressed="${pressed}">${escapeHtml(action.label)}</button>`;
    })
    .join("");

  const lanes = derived.lanes
    .map((lane) => {
      const items =
        lane.items.length > 0
          ? lane.items
              .map((item) => `<li data-scout-result="${escapeHtml(item.id)}">${renderResult(item)}</li>`)
              .join("")
          : `<li data-scout-empty="${escapeHtml(lane.id)}">${escapeHtml(lane.emptyTitle ?? "No results")}</li>`;
      return `<section data-scout-lane="${escapeHtml(lane.id)}"><h2>${escapeHtml(lane.title)}</h2><p>${escapeHtml(lane.subtitle ?? "")}</p><ul>${items}</ul></section>`;
    })
    .join("");

  const markers = derived.markers
    .map(
      (marker) =>
        `<li data-scout-marker="${escapeHtml(marker.id)}">${escapeHtml(marker.title)}:${marker.coordinates.lat},${marker.coordinates.lng}</li>`,
    )
    .join("");

  return [
    `<main data-scout-blueprint="${escapeHtml(config.productName)}">`,
    `<form role="search" data-scout-search-state="${derived.state.query ? "typed" : "default"}">`,
    `<input aria-label="Search ${escapeHtml(config.productName)}" value="${escapeHtml(derived.state.query)}" />`,
    `<button type="button" data-scout-reset="true">Reset</button>`,
    `</form>`,
    `<nav aria-label="Scout actions">${actions}</nav>`,
    `<output data-scout-result-count="${derived.resultCount}">${derived.resultCount} results</output>`,
    `<div data-scout-active-lane="${escapeHtml(derived.activeLane.id)}">${lanes}</div>`,
    `<aside aria-label="Map markers"><ul>${markers}</ul></aside>`,
    `</main>`,
  ].join("");
}

export function escapeScoutDemoHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDefaultResult(item: ScoutEntity): string {
  return `<strong>${escapeScoutDemoHtml(item.title)}</strong><span>${escapeScoutDemoHtml(item.subtitle ?? item.kind)}</span>`;
}

const escapeHtml = escapeScoutDemoHtml;
