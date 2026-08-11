/**
 * Client for the Modal Playwright browser automation endpoint.
 */

const MODAL_BROWSER_URL =
  process.env.MODAL_BROWSER_URL ||
  "https://your-workspace--klaw-browser-browser-action.modal.run";

export type BrowserAction =
  | "navigate"
  | "click"
  | "type"
  | "screenshot"
  | "content";

export type BrowserActionInput = {
  action: BrowserAction;
  url: string;
  selector?: string;
  text?: string;
  wait_ms?: number;
};

export type BrowserActionResult = {
  success: boolean;
  content?: string;
  error?: string;
  url?: string;
  title?: string;
  screenshot_base64?: string;
  action?: string;
};

export async function runBrowserAction(
  input: BrowserActionInput
): Promise<BrowserActionResult> {
  try {
    const response = await fetch(MODAL_BROWSER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Browser Modal API ${response.status} ${response.statusText}`,
        content: "",
      };
    }

    return await response.json();
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || "Browser action failed",
      content: "",
    };
  }
}
