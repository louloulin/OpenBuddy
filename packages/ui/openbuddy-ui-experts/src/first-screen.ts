/**
 * 首屏叶子导出面。
 *
 * 首屏 conversation 图(AppShell/Composer/InputAddMenu)只需要 ThumbImg /
 * LetterAvatar / CONNECTOR_LIST 三个叶子;若它们走根 barrel(`.`),整包
 * ExpertsTab/MarketplacePanel 乃至 ui-mcp 面板都会被静态拖进首屏闭包。
 * 消费方一律从 `@openbuddy/ui-experts/first-screen` 引用,根 barrel 只留给
 * 懒加载面板(ExpertsPanel 等)使用。
 */
export { ThumbImg } from "./shared/ThumbImg";
export { LetterAvatar } from "./shared/LetterAvatar";
export { CONNECTOR_LIST } from "./data/connectors-catalog";
