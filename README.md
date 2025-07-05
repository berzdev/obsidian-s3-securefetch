# S3 SecureFetch for Obsidian

S3 SecureFetch is an Obsidian plugin that enhances security by automatically converting your standard S3 and S3-compatible object storage links into secure, time-limited pre-signed URLs. This allows you to safely embed and access private files (like images, videos, and PDFs) in your notes without exposing long-lived credentials or making your files public.

## Features

- **Automatic URL Conversion**: Intercepts links matching a defined pattern and replaces them with secure, pre-signed URLs on the fly.
- **S3 & S3-Compatible**: Works with both AWS S3 and other S3-compatible services like MinIO, Cloudflare R2, or DigitalOcean Spaces.
- **Two Authentication Modes**:
    1.  **S3 Pre-signed URL (Recommended)**: Generates a secure URL with a limited lifetime.
    2.  **Simple Parameter**: Appends a static key/value pair to the URL for services that use a simple token-based authentication.
- **Seamless Integration**: Works automatically on page load, with link clicks, and for various media types (`<img>`, `<video>`, `<a>`, etc.).
- **Configurable**: Easily configure URL patterns, credentials, and authentication mode through the settings panel.

## How it works

The plugin works by intercepting web requests made by Obsidian for external resources. When a URL matches the pattern you've configured in the settings, S3 SecureFetch steps in:

1.  It reads your S3 credentials from the plugin settings.
2.  It uses the AWS SDK to request a temporary, pre-signed URL for the requested object (e.g., an image).
3.  It replaces the original `src` or `href` attribute of the element with this new, secure URL.

The result is that Obsidian can display your private S3 content without the original, insecure link ever being exposed to your final Markdown File.

## Installation

1.  Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin in Obsidian.
2.  Open the command palette and run the command `BRAT: Add a beta plugin for testing`.
3.  Enter the URL of this repository: `https://github.com/berzdev/obsidian-s3-securefetch.git`
4.  Enable the "S3 SecureFetch" plugin in the "Community Plugins" settings tab.

## Configuration

After installing, you must configure the plugin. Go to `Settings` -> `S3 SecureFetch`.

1.  **Match URL Pattern**: This is the most important setting. Enter the base URL of your S3-compatible storage. The plugin will only process URLs that start with this pattern.
    -   *Example*: `https://my-private-files.s3.us-east-1.amazonaws.com`
    -   *Example (MinIO)*: `http://192.168.1.100:9000`

2.  **Use S3 Pre-signed URL**:
    -   **Enable this (recommended)** to use the secure pre-signing method.
    -   **Disable this** to fall back to the simple parameter mode.

### S3 Pre-signed URL Settings

These settings are only visible when the "Use S3 Pre-signed URL" toggle is enabled.

-   **S3 Bucket Name**: The name of your S3 bucket.
    -   *Example*: `my-private-files`
-   **S3 Access Key ID**: Your S3 access key.
-   **S3 Secret Access Key**: Your S3 secret key.
-   **S3 Region**: The AWS region where your bucket is located.
    -   *Example*: `us-east-1`
-   **S3 Endpoint (Optional)**: If you are **not** using AWS S3, enter the full endpoint URL of your S3-compatible service here.
    -   *Example (MinIO)*: `http://192.168.1.100:9000`
    -   *Example (Cloudflare R2)*: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

### Simple Parameter Settings

These settings are only visible when the "Use S3 Pre-signed URL" toggle is disabled.

-   **Parameter Key**: The name of the query parameter to add (e.g., `token`).
-   **Parameter Value**: The value of the query parameter (e.g., your secret token).

## Use Cases

-   **Securely embed private images**: Keep your S3 bucket private and still embed images in your notes.
-   **Access private PDFs and videos**: Link to sensitive documents or videos in your vault without making them publicly accessible.
-   **Journaling with private media**: Add personal photos or videos to your daily notes, knowing they are stored securely.
-   **Team knowledge base**: Use a central, private S3 bucket for company assets and securely link to them in a shared Obsidian vault.

## License

This plugin is released under the MIT License. See the [LICENSE](LICENSE) file for more details.
