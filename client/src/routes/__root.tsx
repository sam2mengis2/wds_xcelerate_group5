import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { TanStackDevtools } from '@tanstack/react-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';

type RouterContext = {
  queryClient: QueryClient;
};

// Layout shared by every page: nav on top, the current page renders in <Outlet />.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,

  // TODO: replace this
  notFoundComponent: () => <p className="p-6">Page not found.</p>,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      <TanStackDevtools
        config={{ position: 'bottom-right' }}
        plugins={[{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> }]}
      />
    </>
  );
}
