# ChatGPT image → CloudHarness workspace: authorized browser handoff

## Scope
The ChatGPT conversation and CloudHarness workspace are separate security principals and filesystems. **CloudHarness cannot read ChatGPT file IDs, `sediment://` pointers, local model container `/mnt/data`, nor arbitrary ChatGPT image URLs.** This feature does not change that boundary and does not secretly pull user data from ChatGPT.

CloudHarness already implements an owner-authenticated, same-origin, CSRF-protected Dashboard binary upload endpoint (`POST /dashboard/api/v1/workspaces/:workspaceId/assets/upload?path=...`), which delegates to `asset_import` and validates image signature, size and SHA-256. The Files UI now lets an authorized human supply image bytes by **Ctrl+V** or **drag and drop**, as an alternative to selecting a local file.

## How to operate (human-in-the-loop)
1. In ChatGPT Image, finish the Ninja SOUTH and copy the **image itself** (not the conversation text or URL). Some browsers or clients may not expose a copy-image command.
2. In a logged-in CloudHarness Dashboard, open an ACTIVE workspace's **Files** tab; focus the `Paste an image from ChatGPT` area, and press **Ctrl+V**, or drag and drop the image. The area stages PNG, JPEG, or WebP only. It **does not auto-upload**.
3. Confirm the displayed staged type/size, choose/verify the workspace destination and press **Upload file**. The existing CSRF-protected upload endpoint is used. The browser computes SHA-256 when Web Crypto is available, and checks the response digest. Existing files are not overwritten.
4. Tell the ChatGPT agent the CloudHarness workspace path (no file bytes need to be pasted in text). The agent uses `image_inspect` and the Orion-Asset `orion-chat-intake` command against this actual workspace file, retaining a PREVIEW_ONLY decision for visual quality.

### Image-byte provenance
Browser copy/paste may *re-encode* the image. CloudHarness verifies what was actually pasted and uploaded, but cannot attest that those bytes equal the original high-resolution ChatGPT Image file. When exact original bytes and a pre-recorded chat-side SHA-256 are required, use the **original downloaded PNG file** in the existing Files picker, not clipboard. The Orion receipt comparison then protects against wrong versions and transformed bytes. A source clipboard image is a **derived image** until byte-identity with the master is independently established.

### Security and limitations
- Paste/drop requires an explicit **user gesture** in a focused Dashboard control. The final **Upload file** click is separate.
- No credentials, account tokens, arbitrary URL fetching or unscoped file access. Upload remains bound to the dashboard session, CSRF token and CloudHarness workspace principal.
- Only known image MIME types are accepted from clipboard, within the existing 6,000,000-byte upload limit.
- This does **not** deliver a zero-interaction ChatGPT-attachment → CloudHarness connector tool. That feature requires ChatGPT/OpenAI host to expose an authorized attachment-byte handoff to the connector, as separately specified in SpriteForge Issue #52.
- This feature does not invoke ChatGPT Image, generate art, run Orion automatically, or auto-approve game assets.
