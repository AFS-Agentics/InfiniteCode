import { Route, Routes } from "react-router-dom";

import { HomePage } from "@/pages/home";
import { DocsRoutes } from "@/routes/docs";

export default function App() {
	return (
		<Routes>
			<Route index element={<HomePage />} />
			<Route path="/docs/*" element={<DocsRoutes />} />
			<Route path="*" element={<HomePage />} />
		</Routes>
	);
}
