const path = require('path')

const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
const nextConfig = {"env":{"APP_REVISION":"797e7c3e824fbf6e2246b1bbd96545ebc326706a","APP_RELEASE":"v0.5.387"},"eslint":{"ignoreDuringBuilds":false},"typescript":{"ignoreBuildErrors":false,"tsconfigPath":"tsconfig.json"},"distDir":"./.next","cleanDistDir":true,"assetPrefix":"","cacheMaxMemorySize":52428800,"configOrigin":"next.config.mjs","useFileSystemPublicRoutes":true,"generateEtags":true,"pageExtensions":["tsx","ts","jsx","js"],"poweredByHeader":false,"compress":true,"analyticsId":"","images":{"deviceSizes":[640,750,828,1080,1200,1920,2048,3840],"imageSizes":[16,32,48,64,96,128,256,384],"path":"/_next/image","loader":"default","loaderFile":"","domains":[],"disableStaticImages":false,"minimumCacheTTL":60,"formats":["image/webp"],"dangerouslyAllowSVG":false,"contentSecurityPolicy":"script-src 'none'; frame-src 'none'; sandbox;","contentDispositionType":"inline","remotePatterns":[],"unoptimized":true},"devIndicators":{"buildActivity":true,"buildActivityPosition":"bottom-right"},"onDemandEntries":{"maxInactiveAge":60000,"pagesBufferLength":5},"amp":{"canonicalBase":""},"basePath":"","sassOptions":{},"trailingSlash":false,"i18n":null,"productionBrowserSourceMaps":false,"optimizeFonts":true,"excludeDefaultMomentLocales":true,"serverRuntimeConfig":{},"publicRuntimeConfig":{},"reactProductionProfiling":false,"reactStrictMode":null,"httpAgentOptions":{"keepAlive":true},"outputFileTracing":true,"staticPageGenerationTimeout":60,"swcMinify":true,"output":"standalone","modularizeImports":{"@mui/icons-material":{"transform":"@mui/icons-material/{{member}}"},"lodash":{"transform":"lodash/{{member}}"}},"experimental":{"multiZoneDraftMode":false,"prerenderEarlyExit":false,"serverMinification":true,"serverSourceMaps":false,"linkNoTouchStart":false,"caseSensitiveRoutes":false,"clientRouterFilter":true,"clientRouterFilterRedirects":false,"fetchCacheKeyPrefix":"","middlewarePrefetch":"flexible","optimisticClientCache":true,"manualClientBasePath":false,"cpus":1,"memoryBasedWorkersCount":false,"isrFlushToDisk":true,"workerThreads":false,"optimizeCss":false,"nextScriptWorkers":false,"scrollRestoration":false,"externalDir":false,"disableOptimizedLoading":false,"gzipSize":true,"craCompat":false,"esmExternals":true,"fullySpecified":false,"outputFileTracingRoot":"/opt/aries-router","swcTraceProfiling":false,"forceSwcTransforms":false,"largePageDataBytes":128000,"adjustFontFallbacks":false,"adjustFontFallbacksWithSizeAdjust":false,"typedRoutes":false,"instrumentationHook":false,"bundlePagesExternals":false,"parallelServerCompiles":false,"parallelServerBuildTraces":false,"ppr":false,"missingSuspenseWithCSRBailout":true,"optimizeServerReact":true,"useEarlyImport":false,"staleTimes":{"dynamic":30,"static":300},"outputFileTracingExcludes":{"*":["./gitbook/**/*","**/AppData/Local/**/*","**/AppData/Roaming/**/*","**/.config/**/*","**/.codex/**/*","**/Cookies/**/*"]},"serverComponentsExternalPackages":["better-sqlite3","sql.js","node:sqlite","bun:sqlite","open"],"proxyClientMaxBodySize":"128mb","serverComponentsHmrCache":true,"optimizePackageImports":["@xyflow/react","@dnd-kit/core","@dnd-kit/sortable","material-symbols","marked","lucide-react","date-fns","lodash-es","ramda","antd","react-bootstrap","ahooks","@ant-design/icons","@headlessui/react","@headlessui-float/react","@heroicons/react/20/solid","@heroicons/react/24/solid","@heroicons/react/24/outline","@visx/visx","@tremor/react","rxjs","@mui/material","@mui/icons-material","recharts","react-use","@material-ui/core","@material-ui/icons","@tabler/icons-react","mui-core","react-icons/ai","react-icons/bi","react-icons/bs","react-icons/cg","react-icons/ci","react-icons/di","react-icons/fa","react-icons/fa6","react-icons/fc","react-icons/fi","react-icons/gi","react-icons/go","react-icons/gr","react-icons/hi","react-icons/hi2","react-icons/im","react-icons/io","react-icons/io5","react-icons/lia","react-icons/lib","react-icons/lu","react-icons/md","react-icons/pi","react-icons/ri","react-icons/rx","react-icons/si","react-icons/sl","react-icons/tb","react-icons/tfi","react-icons/ti","react-icons/vsc","react-icons/wi"],"trustHostHeader":false,"isExperimentalCompile":false},"configFileName":"next.config.mjs","outputFileTracingRoot":"/opt/aries-router","outputFileTracingExcludes":{"*":["./gitbook/**/*","**/AppData/Local/**/*","**/AppData/Roaming/**/*","**/.config/**/*","**/.codex/**/*","**/Cookies/**/*"]},"serverExternalPackages":["better-sqlite3","sql.js","node:sqlite","bun:sqlite","open"],"turbopack":{"root":"/opt/aries-router"},"_originalRewrites":{"beforeFiles":[],"afterFiles":[{"source":"/v1/models/:path*","destination":"/api/v1/models/:path*"},{"source":"/v1/models","destination":"/api/v1/models"},{"source":"/models/:path*","destination":"/api/v1/models/:path*"},{"source":"/models","destination":"/api/v1/models"},{"source":"/model/:path*","destination":"/api/v1/models/:path*"},{"source":"/model","destination":"/api/v1/models"},{"source":"/v1/model/:path*","destination":"/api/v1/models/:path*"},{"source":"/v1/model","destination":"/api/v1/models"},{"source":"/v1/v1/:path*","destination":"/api/v1/:path*"},{"source":"/v1/v1","destination":"/api/v1"},{"source":"/codex/:path*","destination":"/api/v1/responses"},{"source":"/responses","destination":"/api/v1/responses"},{"source":"/systemone","destination":"/api/v1/systemone"},{"source":"/v1beta/:path*","destination":"/api/v1beta/:path*"},{"source":"/v1beta","destination":"/api/v1beta"},{"source":"/v1/:path*","destination":"/api/v1/:path*"},{"source":"/v1","destination":"/api/v1"}],"fallback":[]}}

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)

require('next')
const { startServer } = require('next/dist/server/lib/start-server')

if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined
}

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});