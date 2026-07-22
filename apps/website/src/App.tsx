import { Route, Routes } from "react-router-dom"

import { AuthProvider } from "@/components/auth-provider"

import { HomePage } from "@/pages/home"
import { DocsRoutes } from "@/routes/docs"
import Login from "@/pages/Login"
import SignupPage from "@/pages/auth/Signup"
import ForgotPasswordPage from "@/pages/auth/ForgotPassword"
import ResetPasswordPage from "@/pages/auth/ResetPassword"
import ProfilePage from "@/pages/Profile"

export default function App() {
	return (
		<AuthProvider>
			<Routes>
				<Route index element={<HomePage />} />
				<Route path="/login" element={<Login />} />
				<Route path="/signup" element={<SignupPage />} />
				<Route path="/forgot-password" element={<ForgotPasswordPage />} />
				<Route path="/reset-password" element={<ResetPasswordPage />} />
				<Route path="/profile" element={<ProfilePage />} />
				<Route path="/docs/*" element={<DocsRoutes />} />
				<Route path="*" element={<HomePage />} />
			</Routes>
		</AuthProvider>
	)
}
