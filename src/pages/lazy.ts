import { lazy } from 'react';

// Each page is its own download, fetched the first time it is opened — or a
// moment before, when its link is pointed at — so a first visit only waits
// for the page it is actually on.

const load = {
  shell: () => import('../components/Shell'),
  dashboard: () => import('./DashboardPage'),
  store: () => import('./StorePage'),
  bills: () => import('./BillsPage'),
  explosives: () => import('./ExplosivesPage'),
  getApp: () => import('./GetAppPage'),
  history: () => import('./HistoryPage'),
  users: () => import('./UsersPage'),
  sales: () => import('./SalesPage'),
  verify: () => import('./VerifyPage'),
  finance: () => import('./FinancePage'),
  login: () => import('./LoginPage'),
};

export const Shell = lazy(() => load.shell().then((module) => ({ default: module.Shell })));
export const DashboardPage = lazy(() => load.dashboard().then((module) => ({ default: module.DashboardPage })));
export const StorePage = lazy(() => load.store().then((module) => ({ default: module.StorePage })));
export const BillsPage = lazy(() => load.bills().then((module) => ({ default: module.BillsPage })));
export const ExplosivesPage = lazy(() => load.explosives().then((module) => ({ default: module.ExplosivesPage })));
export const GetAppPage = lazy(() => load.getApp().then((module) => ({ default: module.GetAppPage })));
export const HistoryPage = lazy(() => load.history().then((module) => ({ default: module.HistoryPage })));
export const UsersPage = lazy(() => load.users().then((module) => ({ default: module.UsersPage })));
export const SalesPage = lazy(() => load.sales().then((module) => ({ default: module.SalesPage })));
export const VerifyPage = lazy(() => load.verify().then((module) => ({ default: module.VerifyPage })));
export const FinancePage = lazy(() => load.finance().then((module) => ({ default: module.FinancePage })));
export const LoginPage = lazy(() => load.login().then((module) => ({ default: module.LoginPage })));

const byPath: Record<string, () => Promise<unknown>> = {
  // The dashboard is where a sign-in lands, so it comes with the signed-in
  // shell around it.
  '/': () => Promise.all([load.shell(), load.dashboard()]),
  '/store': load.store,
  '/bills': load.bills,
  '/explosives': load.explosives,
  '/get-app': load.getApp,
  '/history': load.history,
  '/users': load.users,
  '/sales': load.sales,
  '/verify': load.verify,
  '/finance': load.finance,
};

/** Starts downloading a page's code before it is opened. */
export function prefetchPage(path: string): void {
  // With no connection the attempt could only fail.
  if (!navigator.onLine) return;
  byPath[path]?.().catch(() => {});
}
