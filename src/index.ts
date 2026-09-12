import {
    Constants,
    getFrontend,
    openTab,
    Plugin,
    Protyle,
    showMessage,
} from "siyuan";
import type {
    Custom,
    IProtyleOptions,
} from "siyuan";
import type zhCN from "./i18n/zh-CN.json";
import "./index.scss";

const TAB_TYPE = "tempEdit";
const TAB_ICON = "iconEdit";
// 固定数据用于复用同一个临时编辑页签，重复点击顶栏按钮时切换到已打开的页签
const TAB_DATA = {id: "temp-edit"};

// lite 模式仅在前端记录撤销（LocalUndo），事务不会提交到内核，因此不会写入工作空间；
// 置空上传地址可避免粘贴图片等资源时写入 工作空间/data/assets
const EDITOR_OPTIONS: IProtyleOptions = {
    lite: true,
    blockId: "",
    action: [],
    render: {
        gutter: false,
        breadcrumb: false,
        scroll: false,
        background: false,
        title: false,
    },
    upload: {
        url: "",
    },
};

interface ITempEditor {
    instance: Protyle;
    hintElement: HTMLElement;
}

// 与内核 genEmptyElement(false, false) 保持一致，用于初始化可编辑空段落
const genEmptyParagraph = () => {
    const element = document.createElement("div");
    element.setAttribute("data-node-id", window.Lute.NewNodeID());
    element.setAttribute("data-type", "NodeParagraph");
    element.className = "p";
    element.innerHTML =
        `<div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}"></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
    return element;
};

export default class TempEditPlugin extends Plugin {
    declare i18n: typeof zhCN;

    private readonly editors = new Map<Element, ITempEditor>();
    private isMobile = false;

    onload() {
        this.isMobile = getFrontend().endsWith("mobile");
        if (this.isMobile) {
            // 自定义页签仅桌面端支持
            return;
        }
        // 页签回调中的 this 指向 Custom 实例，这里用箭头函数在闭包中保留插件实例
        const mountTab = (custom: Custom) => this.mount(custom);
        const resizeTab = (element: Element) => this.editors.get(element)?.instance.resize();
        const unmountTab = (element: Element) => this.unmount(element);
        // 注册自定义页签类型，页签内容由 Protyle Lite 临时编辑器填充
        // 插件声明文件里 init/resize/destroy 未标注 this，这里按实际运行时的 Custom 实例处理
        const tabOptions = {
            type: TAB_TYPE,
            init(this: Custom) {
                mountTab(this);
            },
            resize(this: Custom) {
                resizeTab(this.element);
            },
            destroy(this: Custom) {
                unmountTab(this.element);
            },
        };
        this.addTab(tabOptions as unknown as Parameters<Plugin["addTab"]>[0]);
    }

    onLayoutReady() {
        if (this.isMobile) {
            return;
        }
        this.addTopBar({
            icon: TAB_ICON,
            title: this.i18n.topBarTitle,
            position: "right",
            callback: () => {
                this.openTempEditTab();
            },
        });
    }

    onunload() {
        Array.from(this.editors.keys()).forEach((element) => {
            this.unmount(element);
        });
    }

    private openTempEditTab() {
        openTab({
            app: this.app,
            custom: {
                id: this.name + TAB_TYPE,
                icon: TAB_ICON,
                title: this.i18n.tabTitle,
                data: TAB_DATA,
            },
        });
    }

    private mount(custom: Custom) {
        const panel = custom.element as HTMLElement;
        panel.classList.add("temp-edit__panel");
        panel.innerHTML = `<div class="temp-edit__header">
    <span class="temp-edit__title">${this.i18n.tabTitle}</span>
    <span class="temp-edit__tip">${this.i18n.tabTip}</span>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--outline temp-edit__copy">${this.i18n.copyBtn}</button>
    <button class="b3-button b3-button--outline temp-edit__clear">${this.i18n.clearBtn}</button>
</div>
<div class="temp-edit__body"></div>`;

        const instance = new Protyle(this.app, panel.querySelector<HTMLElement>(".temp-edit__body"), EDITOR_OPTIONS);
        const protyle = instance.protyle;
        // 未加载文档时不会写入该属性，需与内核加载文档后的状态保持一致
        protyle.wysiwyg.element.setAttribute("data-readonly", "false");
        // 提示层按视口定位，挂载到 body 避免被页签容器裁剪
        const hintElement = protyle.hint.element;
        document.body.appendChild(hintElement);
        protyle.toolbar.subElement.setAttribute("data-position-boundary", "viewport");

        this.resetContent(instance);
        this.editors.set(custom.element, {instance, hintElement});

        panel.querySelector(".temp-edit__clear").addEventListener("click", () => {
            this.resetContent(instance);
            instance.focus();
        });
        panel.querySelector(".temp-edit__copy").addEventListener("click", () => {
            const markdown = protyle.lute.BlockDOM2StdMd(protyle.wysiwyg.element.innerHTML).trim();
            if (!markdown) {
                showMessage(this.i18n.nothingToCopy);
                return;
            }
            navigator.clipboard?.writeText(markdown).then(() => {
                showMessage(this.i18n.copied);
            }).catch(() => {
                showMessage(this.i18n.copyFailed, 6000, "error");
            });
        });

        instance.focus();
    }

    private unmount(element: Element) {
        const editor = this.editors.get(element);
        if (!editor) {
            return;
        }
        this.editors.delete(element);
        // Protyle 的 destroy 不会移除提示层元素，需手动清理
        editor.hintElement.remove();
        editor.instance.destroy();
    }

    private resetContent(instance: Protyle) {
        const wysiwygElement = instance.protyle.wysiwyg.element;
        wysiwygElement.innerHTML = "";
        wysiwygElement.appendChild(genEmptyParagraph());
        instance.clearStack();
    }
}
