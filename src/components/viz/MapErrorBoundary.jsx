import { Component } from "react";

/**
 * 地图窗口错误边界：捕获 MapWindow/MapCard 子树在渲染或生命周期中的异常，
 * 避免单个地图卡片的崩溃（如高德实例与 React DOM 竞争）拖垮整个 App。
 * 出错时仅隐藏地图窗口，并提示用户重试。
 */
export class MapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.warn("[MapErrorBoundary] 地图窗口异常，已隔离：", error, info);
  }

  render() {
    if (this.state.hasError) {
      return null; // 出错时静默隐藏地图窗口，不阻断主对话
    }
    return this.props.children;
  }
}
