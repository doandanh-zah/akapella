export function publicMediaUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("Nhập link HTTPS công khai hợp lệ.");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Nhập link HTTPS công khai hợp lệ.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !host.includes(".") || host.includes(":") || /^[\d.]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|lan)$/.test(host) || host.endsWith(".home.arpa")) {
    throw new Error("Nhập link HTTPS công khai hợp lệ.");
  }
  url.hash = "";
  return url.href;
}

// Applies to every outbound hop, including extractor redirects and media CDNs.
export const mediaNetworkPolicy = {
  allow: ["*"],
  subnets: {
    deny: [
      "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
      "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16",
      "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15",
      "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
    ],
  },
};
