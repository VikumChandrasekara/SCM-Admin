import { Download } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { LogoPlaque } from '../components/Logo';
import { Button, Panel } from '../components/ui';
import { APP_APK_FILENAME, APP_APK_URL } from '../lib/appDownload';

/**
 * A public page — no sign-in — that hands out the operator app's APK.
 * Operator and compressor crews cannot sign in to this panel, so they reach
 * this one page by a link or a poster QR rather than the login screen.
 */
export function GetAppPage() {
  const qr = useApkQr();

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <LogoPlaque className="mx-auto w-fit" />
        <p className="mt-4 text-center text-sm font-semibold text-white/75">SCM App එක බාගත කරන්න</p>

        <Panel className="mt-6 p-7 text-center">
          <h1 className="text-[22px] font-bold">App එක Download කරන්න</h1>
          <p className="mt-1.5 text-xs text-white/70">
            මෙය Operator සහ Supervisor ගිණුම් සඳහා වන ඇන්ඩ්‍රොයිඩ් app එකයි. ලොග් වීමක් අවශ්‍ය නැත.
          </p>

          {qr && (
            <img
              src={qr}
              alt="App එක බාගත කරන QR කේතය"
              className="mx-auto mt-5 size-44 rounded-control bg-white p-2"
            />
          )}

          <a href={APP_APK_URL} download={APP_APK_FILENAME} rel="noopener" className="mt-5 block">
            <Button size="lg" icon={<Download className="size-4.5" />} className="w-full">
              APK එක බාගත කරන්න
            </Button>
          </a>

          <ol className="mt-6 space-y-1.5 text-left text-xs text-white/70">
            <li>1. ඉහත බොත්තමෙන් හෝ QR කේතය ස්කෑන් කර .apk ගොනුව බාගත කරන්න.</li>
            <li>
              2. Android දැනුම් දෙන්නේ නම් <span className="font-semibold text-white/85">"Install unknown app"</span>{' '}
              ඉඩ දෙන්න — මෙය Play Store එකේ නැති app එකකි.
            </li>
            <li>3. බාගත වූ ගොනුව විවෘත කර Install කරන්න.</li>
          </ol>

          <p className="mt-5 text-[11px] text-white/45">
            app එක තුළින්ම නව අනුවාද පරීක්ෂා කර, ඇත්නම් ස්වයංක්‍රීයව ලබා ගනී — මෙම පිටුව නැවත මතක තබා ගැනීමට
            අවශ්‍ය නොවේ.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/** Drawn locally from the download link — nothing is sent anywhere to make it. */
function useApkQr(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    // APP_APK_URL is same-origin and relative (e.g. "/app/scm-latest.apk"),
    // which a browser resolves fine for the button but means nothing to a
    // phone camera scanning this off a printed poster — the QR needs an
    // absolute URL.
    const absoluteUrl = new URL(APP_APK_URL, window.location.origin).toString();
    QRCode.toDataURL(absoluteUrl, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then((dataUrl) => {
        if (active) setUrl(dataUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return url;
}
