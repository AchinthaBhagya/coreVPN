-- CreateTable
CREATE TABLE `DocumentCounter` (
    `id` VARCHAR(191) NOT NULL,
    `counterKey` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DocumentCounter_counterKey_key`(`counterKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
