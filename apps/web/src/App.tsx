// Author: Brijesh Dave <https://github.com/brijeshdave>
// Application root: providers (query cache, theme) wrapped in an error boundary
// that reports render failures into the server log pipeline, then the router.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Suspense, useState } from "react";

import { ErrorBoundary } from "@/components/error-boundary.js";
import { ThemeProvider } from "@/components/theme-provider.js";
import { createAppRouter } from "@/routes/router.js";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The API is the source of truth; don't hammer it on every focus change.
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter(queryClient));

  return (
    <ErrorBoundary boundary="app">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Suspense fallback={null}>
            <RouterProvider router={router} />
          </Suspense>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
