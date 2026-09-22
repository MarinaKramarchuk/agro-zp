import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { ToastProvider } from './components/ui.jsx';
import { PeriodProvider } from './context/PeriodContext.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { WorklogPage } from './pages/WorklogPage.jsx';
import { MachineDataPage } from './pages/MachineDataPage.jsx';
import { TimesheetPage } from './pages/TimesheetPage.jsx';
import { RepairHoursPage } from './pages/RepairHoursPage.jsx';
import { PayrollPage } from './pages/PayrollPage.jsx';
import { FieldControlPage } from './pages/FieldControlPage.jsx';
import { WaybillPrintPage } from './pages/WaybillPrintPage.jsx';
import { PayslipPrintPage } from './pages/PayslipPrintPage.jsx';
import { WorklogsJournalPage } from './pages/WorklogsJournalPage.jsx';
import { WorkPlansPage } from './pages/WorkPlansPage.jsx';
import { HelpPage } from './pages/HelpPage.jsx';
import {
  EmployeesPage,
  EquipmentPage,
  FieldsPage,
  RoutesPage,
  TariffsPage,
  WorkTypesPage,
} from './pages/references.jsx';

export default function App() {
  return (
    <PeriodProvider>
      <ToastProvider>
        <Routes>
          <Route path="/help" element={<HelpPage />} />
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="/worklogs" element={<WorklogPage />} />
            <Route path="/work-plans" element={<WorkPlansPage />} />
            <Route path="/worklogs/journal" element={<WorklogsJournalPage />} />
            <Route path="/machine-data" element={<MachineDataPage />} />
            <Route path="/timesheet" element={<TimesheetPage />} />
            <Route path="/repair-hours" element={<RepairHoursPage />} />
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/field-control" element={<FieldControlPage />} />
            <Route path="/worklogs/print" element={<WaybillPrintPage />} />
            <Route path="/payroll/print" element={<PayslipPrintPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/equipment" element={<EquipmentPage />} />
            <Route path="/fields" element={<FieldsPage />} />
            <Route path="/work-types" element={<WorkTypesPage />} />
            <Route path="/tariffs" element={<TariffsPage />} />
            <Route path="/routes" element={<RoutesPage />} />
            <Route path="*" element={<Navigate to="/worklogs" replace />} />
          </Route>
        </Routes>
      </ToastProvider>
    </PeriodProvider>
  );
}
