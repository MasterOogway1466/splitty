import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { AuthProvider } from "./lib/AuthContext.js";
import { AcceptInvitePage } from "./pages/AcceptInvitePage.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { CheckYourEmailPage } from "./pages/CheckYourEmailPage.js";
import { ExpenseDetailPage } from "./pages/ExpenseDetailPage.js";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.js";
import { FriendsPage } from "./pages/FriendsPage.js";
import { GroupDetailPage } from "./pages/GroupDetailPage.js";
import { HomePage } from "./pages/HomePage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { PersonPage } from "./pages/PersonPage.js";
import { SettlementDetailPage } from "./pages/SettlementDetailPage.js";
import { ProfilePage } from "./pages/ProfilePage.js";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.js";
import { SignupPage } from "./pages/SignupPage.js";
import { VerifyEmailPage } from "./pages/VerifyEmailPage.js";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/check-your-email" element={<CheckYourEmailPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/groups/:groupId"
          element={
            <ProtectedRoute>
              <GroupDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/friends"
          element={
            <ProtectedRoute>
              <FriendsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses/:expenseId"
          element={
            <ProtectedRoute>
              <ExpenseDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/people/:personId"
          element={
            <ProtectedRoute>
              <PersonPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settlements/:settlementId"
          element={
            <ProtectedRoute>
              <SettlementDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity"
          element={
            <ProtectedRoute>
              <ActivityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute allowUnverified>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
