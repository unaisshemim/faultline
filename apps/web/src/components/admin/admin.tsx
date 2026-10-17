// Adapted from marmelab/shadcn-admin-kit. See LICENSE in this directory.
import { CoreAdminContext, CoreAdminUI, localStorageStore, type CoreAdminProps } from 'ra-core'
import { ThemeProvider } from './theme-provider'
import { Layout } from './layout'

const store = localStorageStore(undefined, 'company-brain')
export function Admin({ children, dataProvider, dashboard }: CoreAdminProps) {
  return <CoreAdminContext dataProvider={dataProvider} store={store}>
    <ThemeProvider defaultTheme="light"><CoreAdminUI layout={Layout} dashboard={dashboard} title="Company Brain" loginPage={false} disableTelemetry>{children}</CoreAdminUI></ThemeProvider>
  </CoreAdminContext>
}
