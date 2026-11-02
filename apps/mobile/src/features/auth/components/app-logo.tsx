import { APP_LOGO_CORNER, APP_LOGO_CUBE, APP_LOGO_SIZE } from "@buildersbot/brand/app-logo-shape";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import Svg, { Circle, G, Path, Polyline, Rect } from "react-native-svg";
import { useCSSVariable } from "uniwind";

import { type AppLogoAnimation, useAppLogoMotion } from "@/features/auth/components/use-app-logo-motion";
import { useText } from "@/shared/lib/text";

export interface AppLogoProps {
  animation?: AppLogoAnimation;
  interactive?: boolean;
  size?: number;
}

// The cube of the app icon, as `AppLogo` of `@buildersbot/brand` draws it on the desktop. Each eye turns
// around its own center (the `transform-origin` of `.app-logo-eye-left/right` in `logo.css`).
const VIEWBOX_SIZE = APP_LOGO_SIZE;
const LEFT_EYE_CENTER_X = 0.357 * VIEWBOX_SIZE;
const RIGHT_EYE_CENTER_X = 0.463 * VIEWBOX_SIZE;
const EYE_CENTER_Y = 0.464 * VIEWBOX_SIZE;
const FACES = [
  [APP_LOGO_CUBE.top, 1],
  [APP_LOGO_CUBE.left, 0.88],
  [APP_LOGO_CUBE.right, 0.72],
] as const;

function resolveColor(value: string | number | undefined, fallback: string): string {
  return String(value ?? fallback);
}

export function AppLogo({ animation = "none", interactive = false, size = VIEWBOX_SIZE }: AppLogoProps) {
  const { t } = useText();
  const backgroundColor = resolveColor(useCSSVariable("--buildersbot-logo-production"), "#98f94f");
  const faceColor = resolveColor(useCSSVariable("--buildersbot-logo-eye"), "#040007");
  const { handlePressIn, leftEyeAnimatedStyle, rightEyeAnimatedStyle } = useAppLogoMotion({ animation, size });
  const eyeLayerStyle = {
    height: size,
    left: 0,
    position: "absolute" as const,
    top: 0,
    width: size,
  };
  const eye = (points: string) => (
    <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
      <G transform={APP_LOGO_CUBE.fit}>
        <Polyline
          points={points}
          fill="none"
          stroke={backgroundColor}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={4}
        />
      </G>
    </Svg>
  );

  const logo = (
    <View
      style={{ height: size, width: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}>
        <Rect
          width={VIEWBOX_SIZE}
          height={VIEWBOX_SIZE}
          rx={APP_LOGO_CORNER}
          ry={APP_LOGO_CORNER}
          fill={backgroundColor}
        />
        <G transform={APP_LOGO_CUBE.fit}>
          {FACES.map(([d, opacity]) => (
            <Path
              key={d}
              d={d}
              fill={faceColor}
              fillOpacity={opacity}
              stroke={backgroundColor}
              strokeWidth={1.1}
              strokeLinejoin="round"
            />
          ))}
          <Circle cx={APP_LOGO_CUBE.dot.cx} cy={APP_LOGO_CUBE.dot.cy} r={APP_LOGO_CUBE.dot.r} fill={backgroundColor} />
        </G>
      </Svg>

      <Animated.View
        pointerEvents="none"
        style={[
          eyeLayerStyle,
          { transformOrigin: [(LEFT_EYE_CENTER_X * size) / VIEWBOX_SIZE, (EYE_CENTER_Y * size) / VIEWBOX_SIZE, 0] },
          leftEyeAnimatedStyle,
        ]}
      >
        {eye(APP_LOGO_CUBE.eyes.left)}
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          eyeLayerStyle,
          { transformOrigin: [(RIGHT_EYE_CENTER_X * size) / VIEWBOX_SIZE, (EYE_CENTER_Y * size) / VIEWBOX_SIZE, 0] },
          rightEyeAnimatedStyle,
        ]}
      >
        {eye(APP_LOGO_CUBE.eyes.right)}
      </Animated.View>
    </View>
  );

  if (!interactive) return logo;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.auth.logo.animate")}
      accessibilityHint={t("mobile.auth.logo.animateHint")}
      onPressIn={handlePressIn}
      pressRetentionOffset={12}
    >
      {logo}
    </Pressable>
  );
}
