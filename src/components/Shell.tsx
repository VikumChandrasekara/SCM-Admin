import { LiveDataProvider } from '../data/LiveData';
import { Layout } from './Layout';

/**
 * Everything behind the sign-in. A download of its own, apart from the login
 * screen, because it brings Firestore with it.
 */
export function Shell() {
  return (
    <LiveDataProvider>
      <Layout />
    </LiveDataProvider>
  );
}
