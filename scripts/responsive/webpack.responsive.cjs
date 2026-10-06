// Responsive baseline build (scripts/responsive/capture.mjs): same surfaces as webpack.config.js, but with
// "@forge/bridge" aliased to the mock so each Custom UI surface renders
// standalone (outside the Forge host). Outputs to static/<name>/build-shot.
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

const ROOT = path.resolve(__dirname, "../..");
const BRIDGE_MOCK = path.resolve(__dirname, "bridge-mock.js");

const moduleRules = {
  rules: [
    {
      test: /\.(js|jsx)$/,
      exclude: /node_modules/,
      use: {
        loader: "babel-loader",
        options: { presets: ["@babel/preset-env", "@babel/preset-react"] },
      },
    },
    { test: /\.(png|jpe?g|gif|svg)$/i, type: "asset/resource", generator: { filename: "assets/[name][ext]" } },
  ],
};

const resolve = {
  extensions: [".js", ".jsx"],
  alias: {
    "@forge/bridge$": BRIDGE_MOCK,
  },
};

const htmlTemplate = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <div id="root"></div>
    <script src="index.js"></script>
  </body>
</html>`;

function shotConfig(name, entry, outputDir, cssFile) {
  return {
    entry: path.resolve(ROOT, entry),
    output: { path: path.resolve(ROOT, outputDir), filename: "index.js", publicPath: "./", clean: true },
    module: moduleRules,
    resolve,
    plugins: [
      new HtmlWebpackPlugin({ filename: "index.html", templateContent: htmlTemplate, inject: false }),
      new CopyWebpackPlugin({ patterns: [{ from: path.resolve(ROOT, `src/ui/tokens/${cssFile}`), to: "styles.css" }] }),
    ],
  };
}

// Output under the (un-shipped) harness dir so build-shot bundles never get
// bundled into the deployed Forge app.
const OUT = "static/_screenshot-harness/shots-responsive";
module.exports = [
  shotConfig("inline-panel",    "./src/ui/surfaces/inline-panel/index.jsx",    `${OUT}/inline-panel`,    "inline-panel.css"),
  shotConfig("steward-console", "./src/ui/surfaces/steward-console/index.jsx", `${OUT}/steward-console`, "steward-console.css"),
  shotConfig("realm-console",   "./src/ui/surfaces/realm-console/index.jsx",   `${OUT}/realm-console`,   "realm-console.css"),
  shotConfig("section-setup",   "./src/ui/surfaces/section-setup/index.jsx",   `${OUT}/section-setup`,   "section-setup.css"),
  shotConfig("overlay",         "./src/ui/surfaces/overlay/index.jsx",         `${OUT}/overlay`,         "overlay.css"),
  shotConfig("doc-ribbon",      "./src/ui/surfaces/doc-ribbon/index.jsx",      `${OUT}/doc-ribbon`,      "doc-ribbon.css"),
  shotConfig("page-details",    "./src/ui/surfaces/page-details/index.jsx",    `${OUT}/page-details`,    "page-details.css"),
  shotConfig("my-work",         "./src/ui/surfaces/my-work/index.jsx",         `${OUT}/my-work`,         "my-work.css"),
];
