/**
 * Convert Collekto AuthZ/Visibility client briefing HTML → editable DOCX
 * with embedded diagram PNGs and rendered Mermaid flowcharts.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = __dirname;
const BUILD = path.join(DIR, ".docx-build");
const HTML_PATH = path.join(DIR, "Collekto-AuthZ-Visibility-Client-Briefing.html");
const OUT_PATH = path.join(DIR, "Collekto-AuthZ-Visibility-Client-Briefing.docx");
const MERMAID_DIR = path.join(BUILD, "mermaid-out");
const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// Resolve deps from local .docx-build install
const HTMLtoDOCX = require(path.join(BUILD, "node_modules", "html-to-docx"));
const MMDC = path.join(
  BUILD,
  "node_modules",
  "@mermaid-js",
  "mermaid-cli",
  "src",
  "cli.js"
);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toDataUri(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace(".", "") || "png";
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "gif"
        ? "image/gif"
        : ext === "svg"
          ? "image/svg+xml"
          : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function imgTag(filePath, alt, widthPx = 620) {
  const dataUri = toDataUri(filePath);
  return (
    `<p style="text-align:center;margin:12pt 0 6pt 0;">` +
    `<img src="${dataUri}" alt="${escapeHtml(alt)}" width="${widthPx}" />` +
    `</p>`
  );
}

function renderMermaidBlocks(html) {
  fs.mkdirSync(MERMAID_DIR, { recursive: true });
  const blocks = [];
  const withPlaceholders = html.replace(
    /<div\s+class="mermaid">([\s\S]*?)<\/div>/gi,
    (_m, body) => {
      const idx = blocks.length;
      blocks.push(body.replace(/^\s+|\s+$/g, ""));
      return `<!--MERMAID_${idx}-->`;
    }
  );

  console.log(`Rendering ${blocks.length} Mermaid diagrams…`);
  const theme = {
    theme: "base",
    themeVariables: {
      primaryColor: "#e6f2ef",
      primaryTextColor: "#1a2332",
      primaryBorderColor: "#0f6b5c",
      lineColor: "#5c6b7a",
      secondaryColor: "#f7f5f0",
      tertiaryColor: "#ffffff",
      fontFamily: "Segoe UI, Arial, sans-serif",
    },
  };
  const configPath = path.join(MERMAID_DIR, "mermaid-config.json");
  fs.writeFileSync(configPath, JSON.stringify(theme));

  const env = {
    ...process.env,
    PUPPETEER_EXECUTABLE_PATH: CHROME,
  };

  for (let i = 0; i < blocks.length; i++) {
    const mmdPath = path.join(MERMAID_DIR, `diagram-${i}.mmd`);
    const pngPath = path.join(MERMAID_DIR, `diagram-${i}.png`);
    fs.writeFileSync(mmdPath, blocks[i], "utf8");
    try {
      execFileSync(
        process.execPath,
        [
          MMDC,
          "-i",
          mmdPath,
          "-o",
          pngPath,
          "-b",
          "white",
          "-s",
          "2",
          "-c",
          configPath,
        ],
        { env, stdio: ["ignore", "pipe", "pipe"] }
      );
      console.log(`  ✓ mermaid ${i + 1}/${blocks.length}`);
    } catch (err) {
      console.error(`  ✗ mermaid ${i + 1} failed:`, err.stderr?.toString?.() || err.message);
      // leave missing; placeholder later
    }
  }

  return withPlaceholders.replace(/<!--MERMAID_(\d+)-->/g, (_m, n) => {
    const i = Number(n);
    const pngPath = path.join(MERMAID_DIR, `diagram-${i}.png`);
    if (fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0) {
      return imgTag(pngPath, `Flow diagram ${i + 1}`, 580);
    }
    return (
      `<p><em>[Flow diagram ${i + 1} could not be rendered]</em></p>` +
      `<pre style="font-family: Consolas, monospace; font-size: 9pt;">` +
      `${escapeHtml(blocks[i])}</pre>`
    );
  });
}

function embedAssetImages(html) {
  return html.replace(/<img\b([^>]*)>/gi, (_m, attrs) => {
    // Already data URI from mermaid step
    if (/src=["']data:/i.test(attrs)) {
      return `<img ${attrs}>`;
    }
    const src = (attrs.match(/\bsrc=["']([^"']+)["']/i) || [])[1] || "";
    const alt = (attrs.match(/\balt=["']([^"']*)["']/i) || [])[1] || "Diagram";
    if (!src || src.startsWith("data:")) {
      return `<img ${attrs}>`;
    }
    const abs = path.isAbsolute(src) ? src : path.join(DIR, src);
    if (!fs.existsSync(abs)) {
      console.warn("Missing image:", src);
      return `<p><em>[Missing diagram: ${escapeHtml(alt)}]</em></p>`;
    }
    console.log("  ✓ image", path.relative(DIR, abs));
    return imgTag(abs, alt, 620);
  });
}

function prepareHtml(raw) {
  const mainMatch = raw.match(/<main[\s\S]*?<\/main>/i);
  if (!mainMatch) throw new Error("Could not find <main> content in HTML");
  let html = mainMatch[0];

  html = html.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Render Mermaid first (placeholders then images)
  html = renderMermaidBlocks(html);

  // Embed local PNG assets as base64
  console.log("Embedding diagram images…");
  html = embedAssetImages(html);

  // Cards / callouts / formula / chips → Word-friendly blocks
  html = html.replace(/<article\b[^>]*>/gi, "<div>");
  html = html.replace(/<\/article>/gi, "</div>");
  html = html.replace(
    /<div\s+class="callout\s+warn"[^>]*>/gi,
    '<div style="border-left: 4px solid #9a5b16; background: #f8efe3; padding: 8pt 10pt; margin: 8pt 0;">'
  );
  html = html.replace(
    /<div\s+class="callout"[^>]*>/gi,
    '<div style="border-left: 4px solid #0f6b5c; background: #e6f2ef; padding: 8pt 10pt; margin: 8pt 0;">'
  );
  html = html.replace(
    /<div\s+class="formula"[^>]*>/gi,
    '<p style="font-family: Consolas, monospace; background: #e6f2ef; padding: 8pt; font-weight: 700;">'
  );

  html = html.replace(/<div\s+class="meta"[^>]*>/gi, "<p>");
  html = html.replace(/<span\s+class="chip"[^>]*>/gi, "<span>");
  html = html.replace(/<\/span>\s*(?=<span)/gi, " · ");

  html = html.replace(/<span\s+class="tag[^"]*"[^>]*>/gi, "<strong>");
  html = html.replace(/<\/span>(?=\s*<\/td>)/gi, "</strong>");

  html = html.replace(
    /<p\s+class="eyebrow"[^>]*>/gi,
    '<p style="text-transform: uppercase; letter-spacing: 2px; color: #0f6b5c; font-weight: 700; font-size: 10pt;">'
  );
  html = html.replace(
    /<p\s+class="lede"[^>]*>/gi,
    '<p style="color: #5c6b7a; font-size: 12pt;">'
  );
  html = html.replace(
    /<p\s+class="diagram-cap"[^>]*>/gi,
    '<p style="color: #5c6b7a; font-size: 10pt; text-align: center;">'
  );

  html = html.replace(
    /<table>/gi,
    '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;">'
  );
  html = html.replace(
    /<th>/gi,
    '<th style="background: #e6f2ef; text-align: left; padding: 6pt;">'
  );
  html = html.replace(/<td>/gi, '<td style="padding: 6pt; vertical-align: top;">');

  // Drop empty grid/card wrappers that only held structure
  html = html.replace(/\sclass="(?:grid-2|grid-3|card|q|muted|hero)"/gi, "");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><title>Collekto — Godrej Hierarchy Solution</title></head>
<body style="font-family: Calibri, Arial, sans-serif; color: #1a2332; font-size: 11pt; line-height: 1.45;">
${html}
</body>
</html>`;
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    throw new Error(`Chrome not found at ${CHROME}`);
  }
  const raw = fs.readFileSync(HTML_PATH, "utf8");
  const html = prepareHtml(raw);

  // Sanity: data URIs present
  const dataUriCount = (html.match(/data:image\/png;base64,/g) || []).length;
  console.log(`Prepared HTML with ${dataUriCount} embedded PNG(s)`);
  if (dataUriCount < 20) {
    throw new Error(
      `Too few embedded images (${dataUriCount}) — expected asset PNGs + Mermaid renders`
    );
  }

  console.log("Building DOCX…");
  const buffer = await HTMLtoDOCX(
    html,
    null,
    {
      title: "Collekto — Godrej Hierarchy Solution",
      subject: "AuthZ / Visibility client briefing for Godrej",
      creator: "Collekto",
      keywords: ["Collekto", "Godrej", "Visibility", "AuthZ", "Hierarchy"],
      description:
        "Client briefing: how the hierarchy / visibility solution works for Godrej.",
      font: "Calibri",
      fontSize: 22,
      lang: "en-US",
      margins: {
        top: 900,
        right: 900,
        bottom: 900,
        left: 900,
      },
      footer: true,
      pageNumber: true,
      table: { row: { cantSplit: true } },
    },
    '<p style="font-size: 9pt; color: #5c6b7a;">Collekto — Godrej Hierarchy · Confidential</p>'
  );

  fs.writeFileSync(OUT_PATH, buffer);
  console.log("Wrote", OUT_PATH);
  console.log("Size", (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(2), "MB");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
