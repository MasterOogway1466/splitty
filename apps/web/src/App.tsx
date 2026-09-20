import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { AuthProvider } from "./lib/AuthContext.js";
import { CheckYourEmailPage } from "./pages/CheckYourEmailPage.js";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.js";
import { HomePage } from "./pages/HomePage.js";
import { LoginPage } from "./pages/LoginPage.js";
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
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
