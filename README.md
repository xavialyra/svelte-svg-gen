# svg-to-svelte

A command-line tool to convert SVG files, URLs, or direct SVG content into Svelte components.  It optimizes SVGs using SVGO, generates Svelte components, and creates a dynamic loader component and TypeScript type definitions for easy use in your Svelte projects.

## Features

*   **SVG Optimization:** Uses SVGO to optimize SVG files, reducing their size and improving performance.  Supports custom SVGO configurations.
*   **Component Generation:**  Automatically generates Svelte components from SVG files.
*   **Flexible Input:** Accepts input from:
    *   Local SVG files
    *   Directories containing SVG files (recursively searches for `.svg` files)
    *   HTTP(S) URLs pointing to SVG files
    *   Directly pasted SVG content
*   **Dynamic Loader:** Creates a dynamic Svelte component for lazy-loading SVG icons.
*   **TypeScript Support:** Generates TypeScript type definitions for the SVG icon names, providing type safety and autocompletion.
*   **Customizable Output:**
    *   Specify the output directory for generated files.
    *   Customize the names of the loader component and type definitions.
    *   Add a base CSS class to the `<svg>` element in the generated components.
*   **Clean Mode:**  Optionally clean the output directory before generating new components.
*   **Regeneration Mode:**  Regenerate the type definitions from existing Svelte components.  Useful for updating your icon set without re-processing the original SVGs.
*   **Interactive Mode:** If no input is provided via command-line arguments, the tool enters an interactive mode to guide you through the process.

## Usage

```bash
npx @xavialyra/svelte-svg-gen [options]
```

### Options

*   `-i, --input <directories|files|urls...>`: Input directories, .svg files, or HTTP(S) URLs (space-separated).
*   `--svg <svg>`: Direct SVG content string (use with `--name`).
*   `--name <name>`: Name for the SVG provided via `--svg`.
*   `-o, --output <directory>`: Output directory for generated files (defaults to `./src/lib/svg-icons`).
*   `--svgoConfig <path>`: Path to custom `svgo.config.js` file.
*   `--clean`: Clean the 'components' subdirectory within the output directory before generating.
*   `--baseClass <class>`: Base CSS class added to the `<svg>` element in components (defaults to `svg-icon`).
*   `-r, --regenerate`: Regenerate `SvgName.ts` from existing components in output/components.
*   `-h, --help`: Show help message.

### Examples

1. **Convert a single SVG file:**

   ```bash
   npx @xavialyra/svelte-svg-gen -i path/to/my-icon.svg
   ```

2. **Convert all SVG files in a directory:**

   ```bash
   npx @xavialyra/svelte-svg-gen -i path/to/icons-directory
   ```

3. **Convert an SVG file from a URL:**

   ```bash
   npx @xavialyra/svelte-svg-gen -i https://example.com/my-icon.svg
   ```

4. **Specify a custom output directory:**

   ```bash
   npx @xavialyra/svelte-svg-gen -i path/to/my-icon.svg -o path/to/my/custom/output
   ```

5. **Specify a custom SVGO configuration file:**

   ```bash
   npx @xavialyra/svelte-svg-gen -i path/to/my-icon.svg --svgoConfig ./svgo.config.js
   ```

6. **Clean the components directory before generating:**

   ```bash
   npx @xavialyra/svelte-svg-gen -i path/to/my-icon.svg --clean
   ```

7. **Regenerate type definitions from existing components:**

   ```bash
   npx @xavialyra/svelte-svg-gen -r
   ```

8. **Interactive mode (no arguments):**

   ```bash
   npx @xavialyra/svelte-svg-gen
   ```

   This mode will prompt you to choose between providing file/URL inputs or pasting SVG content directly.

## Output

The tool generates the following files:

*   `src/lib/svg-icons/components/<IconName>.svelte`: Svelte component for each SVG.
*   `src/lib/svg-icons/<SvgName>.ts`: TypeScript type definition for the SVG icon names.
*   `src/lib/svg-icons/<SvgIcon>.svelte`: Dynamic Svelte component for loading SVG icons.

The default output directory is `src/lib/svg-icons`, but this can be customized using the `--output` option.  The `components` subdirectory is always created within the specified output directory.

## Custom SVGO Configuration

You can provide a custom SVGO configuration file using the `--svgoConfig` option. The path should point to a valid JavaScript file that exports an SVGO configuration object.

Example `svgo.config.js`:

```javascript
export default {
	multipass: true,
	plugins: [
		{
			name: 'preset-default',
			params: {
				overrides: {
					removeViewBox: false
				}
			}
		},
		{ name: 'removeAttrs', params: { attrs: '(stroke|style)' } },
		{
			name: 'addAttributesToSVGElement',
			params: { attributes: [{ focusable: 'false' }, { 'aria-hidden': 'true' }] }
		}
	]
};

```

## Using the Generated Components

```svelte
<script>
  import SvgIcon from '$lib/svg-icons/SvgIcon.svelte';
</script>

<SvgIcon name="file-plus" class="h-11 w-11 fill-transparent stroke-black stroke-1" />

```

## Contributing

Contributions are welcome! Please submit a pull request or create an issue to discuss potential changes.

## License

MIT
