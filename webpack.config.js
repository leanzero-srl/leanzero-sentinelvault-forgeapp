const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

// Shared module rules
const moduleRules = {
  rules: [
    {
      test: /\.(js|jsx)$/,
      exclude: /node_modules/,
      use: {
        loader: "babel-loader",
        options: {
          presets: ["@babel/preset-env", "@babel/preset-react"],
        },
      },
    },
    {
      test: /\.(png|jpe?g|gif|svg)$/i,
      type: "asset/resource",
      generator: {
        filename: "assets/[name][ext]",
      },
    },
  ],
};

const resolve = {
  extensions: [".js", ".jsx"],
};

// HTML template that matches the original structure
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

// Helper to create a build config
function createBuildConfig(name, entry, outputDir, cssFile) {
  return {
    entry,
    output: {
      path: path.resolve(__dirname, outputDir),
      filename: "index.js",
      publicPath: "./",
      clean: true,
    },
    module: moduleRules,
    resolve,
    plugins: [
      new HtmlWebpackPlugin({
        filename: "index.html",
        templateContent: htmlTemplate,
        inject: false,
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, `src/ui/tokens/${cssFile}`),
            to: "styles.css",
          },
        ],
      }),
    ],
  };
}

module.exports = [
  createBuildConfig("overlay",         "./src/ui/surfaces/overlay/index.jsx",         "static/overlay",         "overlay.css"),
  createBuildConfig("steward-console", "./src/ui/surfaces/steward-console/index.jsx", "static/steward-console", "steward-console.css"),
  createBuildConfig("realm-console",   "./src/ui/surfaces/realm-console/index.jsx",   "static/realm-console",   "realm-console.css"),
  createBuildConfig("doc-ribbon",      "./src/ui/surfaces/doc-ribbon/index.jsx",      "static/doc-ribbon",      "doc-ribbon.css"),
  createBuildConfig("inline-panel",    "./src/ui/surfaces/inline-panel/index.jsx",    "static/inline-panel",    "inline-panel.css"),
  createBuildConfig("panel-setup",     "./src/ui/surfaces/panel-setup/index.jsx",     "static/panel-setup",     "panel-setup.css"),
];
