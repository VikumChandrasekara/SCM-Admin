/** A message a site office can act on, in place of a raw Firebase code. */
export function errorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;

  switch (code) {
    case 'permission-denied':
      return 'ඔබට මෙය කිරීමට අවසර නැත.';
    case 'unavailable':
      return 'සර්වරයට සම්බන්ධ විය නොහැක. අන්තර්ජාලය පරීක්ෂා කරන්න.';
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'පරිශීලක නාමය හෝ මුරපදය වැරදියි.';
    case 'auth/email-already-in-use':
      return 'මෙම පරිශීලක නාමය දැනටමත් භාවිතයේ ඇත. වෙනත් එකක් තෝරන්න.';
    case 'auth/weak-password':
      return 'මුරපදය අවම වශයෙන් අක්ෂර 6ක් විය යුතුය.';
    case 'auth/user-disabled':
      return 'මෙම ගිණුම අක්‍රිය කර ඇත.';
    case 'auth/too-many-requests':
      return 'උත්සාහ කීපයක් අසාර්ථකයි. මොහොතකින් නැවත උත්සාහ කරන්න.';
    case 'auth/network-request-failed':
      return 'ජාල සම්බන්ධතාවය පරීක්ෂා කරන්න.';
    case 'auth/operation-not-allowed':
      return 'Firebase Authentication හි Email/Password පිවිසීම සක්‍රිය කර නැත.';
    case 'auth/admin-restricted-operation':
      return 'Firebase හි නව ගිණුම් සෑදීම අක්‍රිය කර ඇත. Console → Authentication → Settings → User actions හි "Enable create (sign-up)" සක්‍රිය කරන්න.';
  }

  if (error instanceof Error && error.message) return error.message;
  return 'අසාර්ථකයි. නැවත උත්සාහ කරන්න.';
}
