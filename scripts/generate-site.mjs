import { readFile, writeFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const templatePath = new URL("site/template.html", root);
const resourcesPath = new URL("resources/resources.json", root);
const availabilityPath = new URL("reports/availability.json", root);
const distDir = new URL("site/dist/", root);
const distPath = new URL("site/dist/index.html", root);
const timeZone = "Asia/Shanghai";
const repoUrl = "https://github.com/baili168/zhuiju-free";

const categories = [
  { id: "online_video", name: "在线影视" },
  { id: "video_app", name: "影视APP" },
  { id: "cloud_search", name: "网盘搜索" },
  { id: "magnet_search", name: "磁力&BT" },
  { id: "subtitles", name: "字幕资源" },
  { id: "player", name: "TVBox/影视仓空壳" },
  { id: "tvbox_config", name: "TVBox/影视仓接口" },
  { id: "subscription", name: "直播源" },
  { id: "membership", name: "会员拼团" },
  { id: "open_source", name: "开源项目" },
  { id: "other", name: "其他" }
];
const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

function recommendationRating(resource) {
  const average =
    (resource.scores.more +
      resource.scores.speed +
      resource.scores.clean +
      resource.scores.stable) /
    4;
  return Math.min(5, Math.max(1, Math.round(average)));
}

function addedAtTime(resource) {
  const timestamp = Date.parse(resource.source?.added_at ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function manualFeaturedOrder(resource) {
  return Number.isFinite(resource.featured_order)
    ? resource.featured_order
    : Number.POSITIVE_INFINITY;
}

function hasResourceNameLink(resource) {
  return typeof resource.link_url === "string" && resource.link_url.length > 0;
}

function isMultiWarehouseResource(resource) {
  return resource.name.includes("多仓");
}

function tvboxConfigSortGroup(resource) {
  if (resource.id === "xiao-he-zi") return 4;
  if (hasResourceNameLink(resource)) return 1;
  if (isMultiWarehouseResource(resource)) return 3;
  return 2;
}

function sortFeaturedResources(resources, categoryId) {
  if (categoryId === "tvbox_config") {
    return [...resources].sort((left, right) => {
      return (
        tvboxConfigSortGroup(left) - tvboxConfigSortGroup(right) ||
        recommendationRating(right) - recommendationRating(left) ||
        manualFeaturedOrder(left) - manualFeaturedOrder(right) ||
        addedAtTime(right) - addedAtTime(left)
      );
    });
  }

  if (categoryId === "open_source") {
    return [...resources].sort((left, right) => {
      return (
        (right.github?.stars ?? 0) - (left.github?.stars ?? 0) ||
        Date.parse(right.github?.pushed_at ?? "") - Date.parse(left.github?.pushed_at ?? "") ||
        left.name.localeCompare(right.name)
      );
    });
  }

  return [...resources].sort((left, right) => {
    return (
      manualFeaturedOrder(left) - manualFeaturedOrder(right) ||
      recommendationRating(right) - recommendationRating(left) ||
      addedAtTime(right) - addedAtTime(left)
    );
  });
}

function shortSummary(resource) {
  return String(resource.summary_short ?? resource.summary).replace(/[。.!！]$/, "");
}

function safeHref(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // fall through
  }
  return "";
}

function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "unknown.invalid";
  }
}

function dateInTimeZone(timestamp) {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(new Date(timestamp))
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

const resourcesData = JSON.parse(await readFile(resourcesPath, "utf8"));
const availabilityData = JSON.parse(await readFile(availabilityPath, "utf8"));
const availabilityById = new Map(
  availabilityData.results.map((result) => [result.resource_id, result])
);

const featuredResources = resourcesData.resources.filter((resource) => resource.featured);

const rows = [];
for (const category of categories) {
  const resources = sortFeaturedResources(
    featuredResources.filter((resource) => resource.category === category.id),
    category.id
  );

  for (const resource of resources) {
    const availability = availabilityById.get(resource.id);
    const isConfig = category.id === "tvbox_config";
    const href = safeHref(resource.link_url ?? resource.url);
    const configUrl = safeHref(resource.url);

    rows.push({
      id: resource.id,
      name: resource.name,
      href: isConfig && !href ? "" : href,
      host: hostOf(resource.url),
      summary: shortSummary(resource),
      categoryId: category.id,
      categoryName: categoryNameById.get(category.id) ?? category.id,
      rating: recommendationRating(resource),
      kind: isConfig ? "config" : category.id === "open_source" ? "open" : "normal",
      configUrl: isConfig ? configUrl : "",
      stars: category.id === "open_source" ? resource.github?.stars ?? 0 : 0,
      status: availability?.status ?? "unknown",
      checkedAt: dateInTimeZone(availability?.checked_at)
    });
  }
}

const generatedDate = dateInTimeZone(availabilityData.generated_at);
const data = {
  meta: {
    repoUrl,
    issueUrl: `${repoUrl}/issues/new?template=broken-link.yml`,
    generatedDate,
    totalCount: resourcesData.resources.length
  },
  rows
};

const template = await readFile(templatePath, "utf8");
const safeJson = JSON.stringify(data).replaceAll("</", "<\\/");
if (!template.includes("__SITE_DATA__")) {
  throw new Error("site/template.html must contain the __SITE_DATA__ placeholder.");
}

await mkdir(distDir, { recursive: true });
await writeFile(distPath, template.replace("__SITE_DATA__", safeJson), "utf8");
console.log(`Site generated at site/dist/index.html with ${rows.length} featured rows.`);