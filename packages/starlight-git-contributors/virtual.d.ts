declare module "virtual:starlight-git-contributors/config" {
	const config: {
		top: number;
		ignore: readonly string[];
		ariaLabel?: string | undefined;
	};
	export default config;
}
