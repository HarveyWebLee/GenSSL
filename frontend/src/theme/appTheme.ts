import type { ThemeConfig } from 'antd';

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1d4f91',
    colorInfo: '#1d4f91',
    colorSuccess: '#2f7d4a',
    colorWarning: '#9a6700',
    colorError: '#b42318',
    colorText: '#1b2430',
    colorTextSecondary: '#5c6775',
    colorBorder: '#e6ebf1',
    colorBorderSecondary: '#edf1f5',
    colorBgLayout: '#f3f5f8',
    colorBgContainer: '#ffffff',
    borderRadius: 8,
    borderRadiusLG: 12,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontSize: 14,
    controlHeight: 36,
    boxShadow: '0 1px 2px rgba(24, 39, 58, 0.04), 0 8px 24px rgba(24, 39, 58, 0.04)',
    boxShadowSecondary: '0 1px 2px rgba(24, 39, 58, 0.04), 0 8px 24px rgba(24, 39, 58, 0.04)',
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      siderBg: '#ffffff',
      bodyBg: '#f3f5f8',
      headerHeight: 72,
    },
    Card: {
      headerFontSize: 15,
      headerHeight: 52,
    },
    Menu: {
      itemBorderRadius: 8,
      itemMarginInline: 4,
      itemMarginBlock: 2,
      iconSize: 16,
    },
    Form: {
      itemMarginBottom: 18,
      labelColor: '#1b2430',
    },
    Table: {
      headerBg: '#f7f9fb',
      headerColor: '#5c6775',
      rowHoverBg: '#f5f8fc',
    },
    Button: {
      fontWeight: 560,
    },
    Alert: {
      borderRadiusLG: 10,
    },
  },
};
