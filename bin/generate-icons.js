#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import { optimize, loadConfig as loadSvgoConfig } from "svgo";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import inquirer from "inquirer";
import kleur from "kleur";
import { createSvelteIconComponent } from "../src/templates/svelteIconTemplate.js";
import { createSvgIconLoaderComponent } from "../src/templates/svgIconLoaderTemplate.js";
const SCRIPT_NAME = "svelte-svg-gen";
const DEFAULT_OUTPUT_DIR = "src/lib/svg-icons";
const COMPONENTS_SUBDIR = "components";
const LOADER_NAME = "SvgIcon";
const TYPE_NAME = "SvgName";
// --- Helper Functions ---
function sanitizeName(name) {
  const baseName = name
    .replace(/\.svg$/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!baseName) {
    return null;
  }
  const componentName = baseName
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return {
    baseName: baseName,
    componentName: componentName,
  };
}
async function loadSvgoConfiguration(configPath) {
  const defaultSvgoConfig = {
    multipass: true,
    plugins: [
      { name: "preset-default", params: { overrides: { removeViewBox: false } } },
      { name: "removeAttrs", params: { attrs: "(stroke|style)" } },
      {
        name: "addAttributesToSVGElement",
        params: { attributes: [{ focusable: "false" }, { "aria-hidden": "true" }] },
      },
      { name: "removeUselessStrokeAndFill" },
    ],
  };
  if (configPath) {
    try {
      const resolvedPath = path.resolve(process.cwd(), configPath);
      if (await fs.pathExists(resolvedPath)) {
        let configModule;
        if (resolvedPath.endsWith(".js") || resolvedPath.endsWith(".mjs")) {
          configModule = (await import(`file://${resolvedPath}`)).default;
        } else {
          configModule = await loadSvgoConfig(resolvedPath);
        }
        if (configModule) {
          console.log(kleur.green(`✔ Loaded custom SVGO config:`), kleur.dim(resolvedPath));
          if (typeof configModule === "object" && configModule !== null) {
            return {
              ...defaultSvgoConfig,
              ...configModule,
              plugins: configModule.plugins || defaultSvgoConfig.plugins,
            };
          }
          return configModule;
        } else {
          console.warn(
            kleur.yellow(`⚠ Custom SVGO config at ${resolvedPath} loaded as null/undefined. Using defaults.`)
          );
        }
      } else {
        console.warn(kleur.yellow(`⚠ Custom SVGO config not found at ${resolvedPath}. Using defaults.`));
      }
    } catch (error) {
      console.error(kleur.red(`✖ Error loading SVGO config from ${configPath}:`), error);
      console.warn(kleur.yellow("Using default SVGO configuration."));
    }
  }
  return defaultSvgoConfig;
}
async function fetchSvgContent(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const content = await response.text();
    const urlPath = new URL(url).pathname;
    const potentialName = path.basename(urlPath) || `graphic-${Date.now()}`;
    return { content, potentialName };
  } catch (error) {
    console.error(kleur.red(`✖ Failed to fetch SVG from ${url}:`), error.message);
    return null;
  }
}
async function resolveInputSources(inputs) {
  const sources = [];
  const cwd = process.cwd();
  if (!inputs || inputs.length === 0) {
    return [];
  }
  for (const input of inputs) {
    if (input.startsWith("http://") || input.startsWith("https://")) {
      console.log(kleur.cyan(`→ Fetching SVG from URL:`), input);
      const result = await fetchSvgContent(input);
      if (result && result.content) {
        const names = sanitizeName(result.potentialName);
        if (!names) {
          console.warn(kleur.yellow(`⚠ Could not derive a valid name from URL ${input}. Skipping.`));
          continue;
        }
        sources.push({
          type: "url",
          origin: input,
          content: result.content,
          baseName: names.baseName,
          componentName: names.componentName,
        });
      }
    } else {
      const absolutePath = path.resolve(cwd, input);
      if (!(await fs.pathExists(absolutePath))) {
        console.warn(kleur.yellow(`⚠ Input path not found, skipping: ${input}`));
        continue;
      }
      try {
        const stats = await fs.stat(absolutePath);
        if (stats.isFile() && absolutePath.toLowerCase().endsWith(".svg")) {
          console.log(kleur.cyan(`→ Processing SVG file:`), input);
          const names = sanitizeName(path.basename(absolutePath));
          if (!names) {
            console.warn(kleur.yellow(`⚠ Could not derive a valid name from file ${input}. Skipping.`));
            continue;
          }
          sources.push({
            type: "file",
            origin: input,
            path: absolutePath,
            baseName: names.baseName,
            componentName: names.componentName,
          });
        } else if (stats.isDirectory()) {
          console.log(kleur.cyan(`→ Searching for SVGs in directory:`), input);
          const pattern = path.join(absolutePath, "**", "*.svg").replace(/\\/g, "/");
          const files = await glob(pattern, { ignore: "**/node_modules/**", nodir: true });
          if (files.length === 0) {
            console.log(kleur.gray(`  No SVG files found in ${input}.`));
          } else {
            console.log(kleur.gray(`  Found ${files.length} SVG files.`));
            for (const file of files) {
              const names = sanitizeName(path.basename(file));
              if (!names) {
                console.warn(kleur.yellow(`⚠ Could not derive a valid name from file ${file}. Skipping.`));
                continue;
              }
              sources.push({
                type: "file",
                origin: path.relative(cwd, file),
                path: file,
                baseName: names.baseName,
                componentName: names.componentName,
              });
            }
          }
        } else {
          console.warn(kleur.yellow(`⚠ Input path is neither a .svg file nor a directory, skipping: ${input}`));
        }
      } catch (statError) {
        console.error(kleur.red(`✖ Error accessing path ${input}:`), statError.message);
      }
    }
  }
  return sources;
}
async function getCurrentIconsFromComponents(iconsComponentDir) {
  const existingIcons = new Map();
  if (!(await fs.pathExists(iconsComponentDir))) {
    return [];
  }
  try {
    const files = await fs.readdir(iconsComponentDir);
    for (const file of files) {
      if (file.toLowerCase().endsWith(".svelte")) {
        const componentName = file.replace(/\.svelte$/i, "");
        try {
          const baseName = componentNameToBaseName(componentName);
          if (!baseName) {
            console.warn(
              kleur.yellow(
                `⚠ Could not determine base name for ${file}. Skipping this component during regeneration/append.`
              )
            );
            continue;
          }
          if (baseName && componentName) {
             existingIcons.set(componentName, { baseName, componentName });
          }
        } catch (readError) {
          console.error(kleur.red(`✖ Error processing component file ${file}:`), readError.message);
        }
      }
    }
  } catch (dirError) {
    console.error(kleur.red(`✖ Error reading components directory ${iconsComponentDir}:`), dirError.message);
  }
  return Array.from(existingIcons.values());
}
function componentNameToBaseName(componentName) {
  if (!componentName) return null;
  return componentName
    .replace(/([A-Z])/g, (match, p1, offset) => (offset > 0 ? "-" : "") + match.toLowerCase())
    .replace(/^-/, "");
}
async function regenerateFilesFromComponents(outputDir, iconsComponentDir, typeName) {
  console.log(
    kleur.magenta(
      `\n♻️ Regenerating files based on components in ${path.relative(process.cwd(), iconsComponentDir)}...`
    )
  );
  const icons = await getCurrentIconsFromComponents(iconsComponentDir);
  if (icons.length === 0) {
    console.warn(
      kleur.yellow(`No valid Svelte components found in ${iconsComponentDir}. Cannot generate type or loader.`)
    );
    return;
  }
  console.log(kleur.cyan(`  Found ${icons.length} components to include.`));
  icons.sort((a, b) => a.baseName.localeCompare(b.baseName));
  const iconMapContent = icons
      .map(icon => `  '${icon.baseName}': '${icon.componentName}',`) // Use baseName for key, componentName for value
      .join('\n');
  const uniqueIconBaseNames = [...new Set(icons.map((icon) => icon.baseName))].sort();

  const typeContent = `// Auto-generated by ${SCRIPT_NAME}\n// Run npx ${SCRIPT_NAME} -r to regenerate.\n\nexport type ${TYPE_NAME} = \n  | '${uniqueIconBaseNames.join("'\n  | '")}';\n\nexport const iconMap: Record<SvgName, string> = {\n${iconMapContent}\n};\n`;
  const typesFileName = `${TYPE_NAME}.ts`;
  const typesOutputPath = path.join(outputDir, typesFileName);
  try {
    await fs.ensureDir(path.dirname(typesOutputPath));
    await fs.writeFile(typesOutputPath, typeContent, "utf-8");
    console.log(
      kleur.green(`  ✔ Regenerated type definition:`),
      kleur.dim(path.relative(process.cwd(), typesOutputPath))
    );
  } catch (error) {
    console.error(kleur.red(`  ✖ Error writing regenerated type definition file ${typesOutputPath}:`), error);
  }

  // --- Generate Dynamic Loader Component ---
  const loaderComponentContent = createSvgIconLoaderComponent();
  const loaderFileName = `${LOADER_NAME}.svelte`;
  const loaderOutputPath = path.join(outputDir, loaderFileName);

  try {

      await fs.ensureDir(path.dirname(loaderOutputPath));
      await fs.writeFile(loaderOutputPath, loaderComponentContent, 'utf-8');
      console.log(kleur.green(`  ✔ Regenerated loader component:`), kleur.dim(path.relative(process.cwd(), loaderOutputPath)));
  } catch (error) {
      console.error(kleur.red(`  ✖ Error writing loader component file ${loaderOutputPath}:`), error);
  }

  console.log(kleur.bold().green("\n♻️ Regeneration complete! ✨\n"));
}

// Processes a single SVG source
async function processSvgSource(source, svgoConfig, baseClass) {
    let svgContent;
    if (source.type === "file") {
      svgContent = await fs.readFile(source.path, "utf-8");
    } else if (source.type === "url" || source.type === "direct") {
      svgContent = source.content;
    } else {
      throw new Error(`Unknown source type: ${source.type}`);
    }

    const optimizeOptions = { ...svgoConfig };
    if (source.path) optimizeOptions.path = source.path;

    const optimizedSvgResult = optimize(svgContent, optimizeOptions);

    if (optimizedSvgResult.error) {
      throw new Error(`SVGO Optimization Error: ${optimizedSvgResult.error}`);
    }
    if (!optimizedSvgResult.data) {
      throw new Error(`SVGO Optimization returned no data.`);
    }

    const svelteComponentContent = createSvelteIconComponent(optimizedSvgResult.data, baseClass);
    return svelteComponentContent;
}

// --- Main Generation Logic ---
async function run() {
  console.log(kleur.bold().cyan(`\n${SCRIPT_NAME} - SVG to Svelte Component Generator\n`));
  // --- Argument Parsing (Remove boolean conflicts from definitions) ---
  let argv = await yargs(hideBin(process.argv))
    .usage(`Usage: ${SCRIPT_NAME} [options]`)
    .option("input", {
      alias: "i",
      type: "array",
      description: "Input directories, .svg files, or HTTP(S) URLs (space-separated)",
    })
    .option("output", {
      alias: "o",
      type: "string",
      description: `Output directory for generated files (defaults to ./${DEFAULT_OUTPUT_DIR})`,
    })
    .option("svgoConfig", {
      type: "string",
      description: "Path to custom svgo.config.js file",
      normalize: true,
    })
    .option("clean", {
      type: "boolean",
      description: `Clean the '${COMPONENTS_SUBDIR}' subdirectory within the output directory before generating`,
      default: false,
    })
    .option("baseClass", {
      type: "string",
      description: "Base CSS class added to the <svg> element in components",
      default: "svg-icon",
    })
    .option("regenerate", {
      alias: "r",
      type: "boolean",
      description: `Regenerate ${TYPE_NAME}.ts and ${LOADER_NAME}.svelte from existing components in output/components`,
      default: false,
    })
    .help()
    .alias("help", "h")
    .parse();
  // --- Manual Conflict Checks ---
  if (argv.regenerate && argv.clean) {
    console.error(kleur.red("✖ Error: The --regenerate and --clean options cannot be used together."));
    process.exit(1);
  }
  if (argv.regenerate && argv.input?.length) {
    console.error(kleur.red("✖ Error: The --regenerate option cannot be used with --input."));
    process.exit(1);
  }

  // --- Resolve Paths and Config early (needed for regenerate) ---
  const outputDirArg = argv.output || DEFAULT_OUTPUT_DIR;
  let outputDir = path.resolve(process.cwd(), outputDirArg);
  let iconsComponentDir = path.join(outputDir, COMPONENTS_SUBDIR);
  const baseClass = argv.baseClass;
  // --- Handle Regeneration Mode ---
  if (argv.regenerate) {
    await regenerateFilesFromComponents(outputDir, iconsComponentDir, TYPE_NAME);
    process.exit(0);
  }
  // --- Determine Input Sources (Args, Direct SVG Args, or Interactive) ---
  let sourcesToProcess = [];
  let inputProvided = false;
  if (argv.input && argv.input.length > 0) {
    console.log(kleur.magenta("Processing inputs from arguments..."));
    sourcesToProcess = await resolveInputSources(argv.input);
    inputProvided = true;
  } else {
    console.log(kleur.yellow("No input method specified via arguments, entering interactive mode:\n"));
     const modeAnswer = await inquirer.prompt([
      {
        type: "list",
        name: "inputMode",
        message: "How would you like to provide SVG sources?",
        choices: [
          { name: "From directories, files, or URLs", value: "files" },
          { name: "Paste SVG content directly", value: "direct" },
        ],
      },
    ]);
    if (modeAnswer.inputMode === "files") {
      const fileAnswers = await inquirer.prompt([
        {
          type: "input",
          name: "input",
          message: "Enter input directories, SVG files, or URLs (space-separated):",
          filter: (input) => input.split(" ").filter(Boolean),
          validate: (value) => (value && value.length > 0 ? true : "Please provide at least one input source."),
        },
      ]);
      argv.input = fileAnswers.input;
      sourcesToProcess = await resolveInputSources(argv.input);
    } else {
      console.log(kleur.cyan("\nEntering direct SVG input mode. Press Ctrl+C to cancel anytime."));
      let addAnother = true;
      while (addAnother) {
        const directAnswers = await inquirer.prompt([
          {
            type: "input",
            name: "graphicName",
            message: 'Enter a name for this SVG graphic (e.g., "arrow-left", "logo-main"):',
            validate: (value) => {
              if (!value || !value.trim()) return "Name cannot be empty.";
              const names = sanitizeName(value.trim());
              if (!names) return "Invalid name format (e.g., use letters, numbers, hyphens, underscores).";
              const exists = sourcesToProcess.some((s) => s.baseName === names.baseName);
              if (exists) return `Name "${names.baseName}" already added in this session. Choose a unique name.`;
              return true;
            },
          },
          {
            type: "input",
            name: "svgContent",
            message: "Paste the full SVG content here (must start with <svg ... >):",
            validate: (value) => {
              const trimmed = value.trim();
              if (!trimmed) return "SVG content cannot be empty.";
              if (!trimmed.toLowerCase().startsWith("<svg")) return 'Content must start with "<svg".';
              if (!trimmed.toLowerCase().endsWith("</svg>")) return 'Content must end with "</svg>".';
              return true;
            },
          },
        ]);
        const names = sanitizeName(directAnswers.graphicName.trim());
        if (names && directAnswers.svgContent) {
          sourcesToProcess.push({
            type: "direct",
            origin: `Direct input: ${directAnswers.graphicName}`,
            content: directAnswers.svgContent.trim(),
            baseName: names.baseName,
            componentName: names.componentName,
          });
          console.log(kleur.green(`  + Added "${names.baseName}" for processing.`));
        } else {
          console.warn(kleur.yellow(`  ⚠ Could not process input for "${directAnswers.graphicName}".`));
        }
        const confirmAnswer = await inquirer.prompt([
          {
            type: "confirm",
            name: "continue",
            message: "Add another SVG directly?",
            default: true,
          },
        ]);
        addAnother = confirmAnswer.continue;
      }
    }
    inputProvided = true;
    console.log("");
  }
  // --- Final Check for Sources ---
    if (sourcesToProcess.length === 0 && inputProvided) {
    console.warn(kleur.yellow("\nNo valid SVG sources found or provided to process. Exiting."));
    process.exit(0);
  } else if (!inputProvided && !argv.regenerate) {
    console.error(
      kleur.red(
        "\n✖ No input sources specified or resolved. Use --input or run without arguments for prompts."
      )
    );
    console.log(kleur.cyan("  Or use --regenerate to rebuild from existing components."));
    process.exit(1);
  }
  // --- Get other options interactively if needed (e.g., output path) ---
   const questions = [];
  if (!argv.output) {
    questions.push({
      type: "input",
      name: "output",
      message: "Enter the output directory:",
      default: DEFAULT_OUTPUT_DIR,
      validate: (value) => (value && value.trim() ? true : "Output path cannot be empty."),
      filter: (value) => value.trim(),
    });
  }
  if (questions.length > 0) {
    console.log(kleur.yellow("Other options missing or using defaults, prompting:\n"));
    const otherAnswers = await inquirer.prompt(questions);
    argv = { ...otherAnswers, ...argv };
    if (otherAnswers.output) {
      outputDir = path.resolve(process.cwd(), argv.output);
        iconsComponentDir = path.join(outputDir, COMPONENTS_SUBDIR);
    }
    console.log("");
  }
  // --- Load SVGO Config ---
  const svgoConfig = await loadSvgoConfiguration(argv.svgoConfig);
  // --- Log Final Configuration ---
  console.log(kleur.magenta("Processing Options:"));
  let inputDesc = "Interactive or Direct Input";
  if (argv.input?.length) inputDesc = `Files/URLs: ${argv.input.join(", ")}`;
  else if (!inputProvided && argv.regenerate) inputDesc = "Regeneration Mode";
  else if (!inputProvided) inputDesc = "No input specified (error handled above)";

  console.log(kleur.gray(`  Input Source:   `), kleur.blue(inputDesc));
  console.log(kleur.gray(`  Output Dir:     `), kleur.blue(path.relative(process.cwd(), outputDir) || "."));
  console.log(kleur.gray(`  Clean Subdir:   `), kleur.blue(argv.clean ? "Yes" : "No"));
  console.log(kleur.gray(`  Base Class:     `), kleur.blue(baseClass || "(None)"));
  console.log(
    kleur.gray(`  SVGO Config:    `),
    kleur.blue(argv.svgoConfig ? path.relative(process.cwd(), argv.svgoConfig) : "Default")
  );
   console.log(kleur.gray(`  Regenerate:     `), kleur.blue(argv.regenerate ? "Yes" : "No"));
  console.log("");
  // --- Prepare Output Directories ---
  try {
    await fs.ensureDir(outputDir);
    if (argv.clean) {
      if (await fs.pathExists(iconsComponentDir)) {
        await fs.emptyDir(iconsComponentDir);
        console.log(
          kleur.yellow(`🧹 Cleaned components subdirectory:`),
          kleur.dim(path.relative(process.cwd(), iconsComponentDir))
        );
      } else {
        console.log(kleur.gray(`Components subdirectory (${COMPONENTS_SUBDIR}) does not exist, skipping clean.`));
        await fs.ensureDir(iconsComponentDir);
      }
    } else {
      await fs.ensureDir(iconsComponentDir);
    }
  } catch (error) {
    console.error(kleur.red(`✖ Error preparing output directories:`), error);
    process.exit(1);
  }
  // --- Process and Generate Individual Svelte Components ---
  console.log(kleur.magenta(`\nProcessing ${sourcesToProcess.length} potential SVG source(s)...`));
  const newlyGeneratedIcons = [];
  const conflicts = [];
  let successCount = 0;
  let errorCount = 0;
  let skipCount = 0;
  const processedComponentNamesInRun = new Set();
  for (const source of sourcesToProcess) {
    if (processedComponentNamesInRun.has(source.componentName)) {
      console.warn(
        kleur.yellow(
          `  ⚠ Skipping duplicate component name "${source.componentName}" in this batch (from ${source.origin}). Choose unique names or sources.`
        )
      );
      errorCount++;
      continue;
    }
    const outputSveltePath = path.join(iconsComponentDir, `${source.componentName}.svelte`);
    let exists = false;
    if (!argv.clean) {
        try {
            exists = await fs.pathExists(outputSveltePath);
        } catch (checkError) {
            console.error(kleur.red(`  ✖ Error checking existence of ${outputSveltePath}:`), checkError.message);
            errorCount++;
            continue;
        }
    }

    if (exists) {
        conflicts.push({ source, outputSveltePath });
        console.log(kleur.yellow(`  ⏳ Conflict detected:`), kleur.dim(`${path.relative(process.cwd(), outputSveltePath)} (from ${source.origin})`));
    } else {
        try {
            const svelteComponentContent = await processSvgSource(source, svgoConfig, baseClass);
            await fs.writeFile(outputSveltePath, svelteComponentContent, "utf-8");
            newlyGeneratedIcons.push({ baseName: source.baseName, componentName: source.componentName });
            processedComponentNamesInRun.add(source.componentName); // Track successful generation
            successCount++;
            console.log(
                kleur.green(`  ✔ Generated:`),
                kleur.dim(`${path.relative(process.cwd(), outputSveltePath)} (from ${source.origin})`)
            );
        } catch (error) {
            errorCount++;
            console.error(kleur.red(`  ✖ Error processing ${source.origin}:`), error.message);
        }
    }
  }

  // --- Handle Conflicts ---
  if (conflicts.length > 0) {
    console.log(kleur.yellow(`\nFound ${conflicts.length} conflict(s) with existing files:`));
    conflicts.forEach(conflict => {
        console.log(kleur.yellow(`  - ${conflict.source.componentName}.svelte`));
    });

    const overwriteAnswer = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: `Do you want to overwrite these ${conflicts.length} existing component file(s)?`,
        default: false,
      },
    ]);

    if (overwriteAnswer.overwrite) {
      console.log(kleur.magenta(`\nOverwriting conflicting files as requested...`));
      for (const conflict of conflicts) {
        const { source, outputSveltePath } = conflict;
         if (processedComponentNamesInRun.has(source.componentName)) {
            console.warn(
              kleur.yellow(
                `  ⚠ Skipping overwrite for "${source.componentName}" as it was already generated from a non-conflicting source in this run.`
              )
            );
            continue;
        }
        try {
          const svelteComponentContent = await processSvgSource(source, svgoConfig, baseClass);
          await fs.writeFile(outputSveltePath, svelteComponentContent, "utf-8");

          newlyGeneratedIcons.push({ baseName: source.baseName, componentName: source.componentName });
          processedComponentNamesInRun.add(source.componentName);
          successCount++;
          console.log(
            kleur.green(`  ✔ Overwritten:`),
            kleur.dim(`${path.relative(process.cwd(), outputSveltePath)} (from ${source.origin})`)
          );
        } catch (error) {
          errorCount++;
          console.error(kleur.red(`  ✖ Error overwriting ${source.origin}:`), error.message);
        }
      }
    } else {
      skipCount = conflicts.length;
      console.log(kleur.gray(`\nSkipped ${skipCount} conflicting file(s).`));
    }
  }

  // --- Report Summary ---
  const totalProcessed = sourcesToProcess.length;
  console.log(
    kleur.cyan(`\nProcessing Summary:`),
    kleur.green(`${successCount} generated/overwritten`),
    kleur.red(`${errorCount} failed`),
    kleur.gray(`${skipCount} skipped (due to conflict)`),
    kleur.dim(`(out of ${totalProcessed} sources)`)
  );
  const componentsExist = await fs.pathExists(iconsComponentDir) &&
                           (await fs.readdir(iconsComponentDir)).some(f => f.toLowerCase().endsWith('.svelte'));
  if (!componentsExist) {
      console.warn(
        kleur.yellow(
          "\nNo Svelte components found in the components directory after processing. Skipping loader and type generation."
        )
      );
      console.log(kleur.bold().yellow("\nGeneration finished, but no components to aggregate. ✨\n"));
      return;
  }
  console.log(kleur.magenta(`\nGenerating aggregate files (${TYPE_NAME}.ts, ${LOADER_NAME}.svelte)...`));
  const finalComponentIcons = await getCurrentIconsFromComponents(iconsComponentDir);
  if (finalComponentIcons.length === 0) {
       console.warn(
        kleur.yellow("No components found after scanning the directory. Skipping loader and types generation.")
      );
      return;
  }
  finalComponentIcons.sort((a, b) => a.baseName.localeCompare(b.baseName));
  console.log(
    kleur.cyan(
      `  Generating aggregate files based on ${finalComponentIcons.length} final ${
        finalComponentIcons.length === 1 ? "component" : "components"
      } in the directory.`
    )
  );
  // --- Generate Type Definition File ---
  const finalIconMapContent = finalComponentIcons
    .map(icon => `  '${icon.baseName}': '${icon.componentName}',`)
    .join('\n');
  const finalUniqueIconBaseNames = [...new Set(finalComponentIcons.map((icon) => icon.baseName))].sort();
  const typeContent = `// Auto-generated by ${SCRIPT_NAME}\n// Run npx ${SCRIPT_NAME} -r to regenerate.\n\nexport type ${TYPE_NAME} = \n  | '${finalUniqueIconBaseNames.join("'\n  | '")}';\n\nexport const iconMap: Record<SvgName, string> = {\n${finalIconMapContent}\n};\n`;
  const typesFileName = `${TYPE_NAME}.ts`;
  const typesOutputPath = path.join(outputDir, typesFileName);
  try {
    await fs.ensureDir(path.dirname(typesOutputPath));
    await fs.writeFile(typesOutputPath, typeContent, "utf-8");
    console.log(kleur.green(`✔ Updated type definition:`), kleur.dim(path.relative(process.cwd(), typesOutputPath)));
  } catch (error) {
    console.error(kleur.red(`✖ Error writing type definition file ${typesOutputPath}:`), error);
  }
  // --- Generate Dynamic Loader Component ---
  const loaderComponentContent = createSvgIconLoaderComponent();
  const loaderFileName = `${LOADER_NAME}.svelte`;
  const loaderOutputPath = path.join(outputDir, loaderFileName);
  try {
    await fs.ensureDir(path.dirname(loaderOutputPath));
    await fs.writeFile(loaderOutputPath, loaderComponentContent, "utf-8");
    console.log(kleur.green(`✔ Updated loader component:`), kleur.dim(path.relative(process.cwd(), loaderOutputPath)));
  } catch (error) {
    console.error(kleur.red(`✖ Error writing loader component file ${loaderOutputPath}:`), error);
  }
  // --- Final Success Message ---
  console.log(kleur.bold().green("\n✨ Generation complete! ✨\n"));
}
// --- Run the script ---
run().catch((error) => {
  if (error.name === "YError") {
    console.error(kleur.red("\n✖ Argument Error:"), error.message || error);
  } else {
    console.error(kleur.red("\n✖ An unexpected error occurred:"), error);
  }
  process.exit(1);
});