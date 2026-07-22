import { Route, Routes } from "react-router-dom";

import { HomePage } from "@/pages/home";
import { DocsRoutes } from "@/routes/docs";
import Login from "@/pages/Login";

export default function App() {
	return (
		<Routes>
			<Route index element={<HomePage />} />
			<Route path="/login" element={<Login />} />
			<Route path="/docs/*" element={<DocsRoutes />} />
			<Route path="*" element={<HomePage />} />
		</Routes>
	);
}
