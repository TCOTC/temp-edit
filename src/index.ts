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
    IOperation,
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
}

// 与内核 genEmptyElement(false, false) 保持一致，用于初始化可编辑空段落
// 传入 id 可复用已有块 ID，供清空操作在撤销栈中保持锚点有效
// 参照 protyle/util/onGet.ts 的写法补上空段落占位提示，由 .protyle-wysiwyg--empty:empty::before 显示
const genEmptyParagraph = (id?: string) => {
    const element = document.createElement("div");
    element.setAttribute("data-node-id", id || window.Lute.NewNodeID());
    element.setAttribute("data-type", "NodeParagraph");
    element.className = "p";
    element.innerHTML =
        `<div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}"></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
    const editElement = element.firstElementChild as HTMLElement;
    editElement.classList.add("protyle-wysiwyg--empty");
    editElement.setAttribute("placeholder", window.siyuan.languages.emptyPlaceholder);
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
        this.addTab({
            type: TAB_TYPE,
            init() {
                mountTab(this);
            },
            resize() {
                resizeTab(this.element);
            },
            destroy() {
                unmountTab(this.element);
            },
        });
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

        this.resetContent(instance);
        this.editors.set(custom.element, {instance});

        panel.querySelector(".temp-edit__clear").addEventListener("click", () => {
            this.clearContent(instance);
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
        editor.instance.destroy();
    }

    private resetContent(instance: Protyle) {
        const wysiwygElement = instance.protyle.wysiwyg.element;
        wysiwygElement.innerHTML = "";
        wysiwygElement.appendChild(genEmptyParagraph());
        instance.clearStack();
    }

    // 清空需通过 transaction 写入撤销栈，lite 模式下仅压入前端栈（LocalUndo）而不提交内核；
    // transaction 不会修改 DOM，因此这里需同步替换本地内容
    private clearContent(instance: Protyle) {
        const wysiwygElement = instance.protyle.wysiwyg.element;
        const blockElements = Array.from(wysiwygElement.children)
            .filter((item) => item.hasAttribute("data-node-id")) as HTMLElement[];
        if (blockElements.length === 0) {
            return;
        }
        const firstBlockElement = blockElements[0];
        // 已是单个空段落时无需清空，避免产生"撤销后无变化"的记录
        if (
            blockElements.length === 1 &&
            firstBlockElement.getAttribute("data-type") === "NodeParagraph" &&
            (firstBlockElement.textContent || "").replace(new RegExp(Constants.ZWSP, "g"), "").trim() === ""
        ) {
            instance.focusBlock(firstBlockElement);
            return;
        }

        // 清空后的空段落复用首块 ID，使撤销/重做中的插入操作始终有可用锚点
        const firstID = firstBlockElement.getAttribute("data-node-id");
        const emptyParagraph = genEmptyParagraph(firstID);
        const doOperations: IOperation[] = [{
            action: "update",
            id: firstID,
            data: emptyParagraph.outerHTML,
        }];
        const undoOperations: IOperation[] = [];
        for (let index = 1; index < blockElements.length; index++) {
            const blockElement = blockElements[index];
            // 逐个插入并以前一个块为锚点，锚点在恢复过程中始终存在
            undoOperations.push({
                action: "insert",
                id: blockElement.getAttribute("data-node-id"),
                data: blockElement.outerHTML,
                previousID: blockElements[index - 1].getAttribute("data-node-id"),
            });
            doOperations.push({
                action: "delete",
                id: blockElement.getAttribute("data-node-id"),
            });
        }
        undoOperations.push({
            action: "update",
            id: firstID,
            data: firstBlockElement.outerHTML,
        });

        wysiwygElement.innerHTML = "";
        wysiwygElement.appendChild(emptyParagraph);
        instance.transaction(doOperations, undoOperations);
        instance.focusBlock(emptyParagraph);
    }
}
