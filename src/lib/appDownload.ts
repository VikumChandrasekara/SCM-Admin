// The operator app has no Play Store listing — the VPS that serves its
// in-app update checks (see ../SCM/lib/services/update_service.dart and
// .github/workflows/release.yml there) also serves a fixed-name copy of the
// newest APK, so this page can link to it without fetching anything.
//
// It has no domain yet, so this stays plain HTTP; the app itself has the same
// exception in android/app/src/main/res/xml/network_security_config.xml.
const UPDATE_SERVER = 'http://169.58.29.10/updates';

export const APP_APK_URL = `${UPDATE_SERVER}/scm-latest.apk`;
