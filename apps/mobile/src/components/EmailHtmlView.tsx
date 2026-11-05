// One message's HTML in a locked-down WebView, sized to its content (see lib/emailHtml.ts for the layers).
import { useMemo, useState } from "react";
import { Linking, PixelRatio, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import { buildEmailDocument, HEIGHT_PROBE, isExternalLink, isInitialLoad } from "../lib/emailHtml";

export function EmailHtmlView({ html, loadImages, cid, label }: { html: string; loadImages: boolean; cid: Record<string, string>; label: string }) {
  const [height, setHeight] = useState(80);
  const fontSize = Math.round(16 * Math.min(PixelRatio.getFontScale(), 2));
  const source = useMemo(() => ({ html: buildEmailDocument(html, { loadImages, cid, fontSize }), baseUrl: "about:blank" }), [html, loadImages, cid, fontSize]);

  const onShouldStart = (req: WebViewNavigation) => {
    if (isInitialLoad(req.url)) return true;
    // Every other navigation is cancelled; a tapped http(s)/mailto/tel link opens outside the app. (Android reports
    // no navigationType; with page scripts blocked by CSP, its navigations come from taps.)
    const tapped = req.navigationType === "click" || req.navigationType === undefined;
    if (tapped && isExternalLink(req.url)) Linking.openURL(req.url).catch(() => {});
    return false;
  };
  const onMessage = (e: WebViewMessageEvent) => {
    const h = Number(e.nativeEvent.data);
    if (Number.isFinite(h) && h > 0) setHeight(Math.min(h, 20_000));
  };

  return (
    <View style={[styles.box, { height }]} accessible accessibilityLabel={label}>
      <WebView
        key={loadImages ? "images" : "blocked"}
        source={source}
        originWhitelist={["about:*", "data:*"]}
        onShouldStartLoadWithRequest={onShouldStart}
        onMessage={onMessage}
        injectedJavaScript={HEIGHT_PROBE}
        injectedJavaScriptForMainFrameOnly
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        allowsLinkPreview={false}
        allowsInlineMediaPlayback={false}
        mediaPlaybackRequiresUserAction
        incognito
        cacheEnabled={false}
        thirdPartyCookiesEnabled={false}
        sharedCookiesEnabled={false}
        // An array: Android passes this prop to native as is, and a bare string aborts the debug build (RNCWebViewProps).
        dataDetectorTypes={["none"]}
        mixedContentMode="never"
        geolocationEnabled={false}
        scrollEnabled={false}
        nestedScrollEnabled={false}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: "hidden", borderRadius: 10, backgroundColor: "#FFFFFF" },
  web: { flex: 1, backgroundColor: "transparent" },
});
