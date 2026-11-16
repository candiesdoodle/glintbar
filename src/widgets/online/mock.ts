/** Browser-preview stand-ins for the online slice's Rust commands. */
import { mockService } from "../../core/mock";

mockService("online", {
  oauth_sign_in: () => {
    throw "unsupported: sign-in works only in the GlintBar desktop app";
  },
  oauth_refresh: () => {
    throw "unsupported: sign-in works only in the GlintBar desktop app";
  },
  set_wallpaper: ({ id }: { url: string; id: string }) => {
    console.info("[mock] set wallpaper", id);
    return { path: `C:\\Users\\you\\AppData\\Roaming\\GlintBar\\wallpapers\\${id}.jpg` };
  },
});
