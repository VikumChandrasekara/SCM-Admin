// The operator app has no Play Store listing, so this panel hosts the APK
// itself: the CI/CD workflow (see .github/workflows/ci-cd.yml) fetches the
// current build from the VPS that the SCM app's own release workflow
// publishes to (see ../SCM/.github/workflows/release.yml and
// lib/services/update_service.dart there) and bundles it into this site's
// Firebase Hosting output at build time.
//
// That makes this a same-origin HTTPS path rather than a link straight to
// the VPS's plain-HTTP host — no mixed content, and no dependency on that
// host's other ports/vhosts being reachable when a crew member opens this
// page.
export const APP_APK_URL = '/app/scm-latest.apk';
